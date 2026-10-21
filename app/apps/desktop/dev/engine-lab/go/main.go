// SPDX-License-Identifier: Apache-2.0
package main

/*
#cgo darwin LDFLAGS: -ldl
#include "go_bridge.h"
*/
import "C"

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"runtime"
	"runtime/cgo"
	"sort"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

type fixture struct {
	Text   string    `json:"text"`
	IDs    []int32   `json:"ids"`
	Vector []float64 `json:"vector"`
}
type reference struct {
	Rows []fixture `json:"rows"`
}
type embedding struct {
	Text   string    `json:"text"`
	IDs    []int32   `json:"-"`
	Vector []float32 `json:"vector"`
}
type request struct {
	Index int
	Done  chan response
}
type response struct {
	Vector []float32
	Err    error
}
type engine struct{ handle unsafe.Pointer }

func newEngine(lib, model string) (*engine, error) {
	clib, cpath := C.CString(lib), C.CString(model)
	defer C.free(unsafe.Pointer(clib))
	defer C.free(unsafe.Pointer(cpath))
	if C.load_engine(clib) != 0 {
		return nil, fmt.Errorf("dlopen/dlsym failed: %s", C.GoString(C.dlerror()))
	}
	h := C.new_engine(cpath)
	if h == nil {
		return nil, errors.New("engine init returned null")
	}
	return &engine{h}, nil
}
func (e *engine) close() { C.free_engine(e.handle) }
func (e *engine) single(ids []int32) ([]float32, error) {
	out := make([]float32, 768)
	if C.embed(e.handle, (*C.int32_t)(unsafe.Pointer(&ids[0])), C.size_t(len(ids)), (*C.float)(unsafe.Pointer(&out[0]))) != 0 {
		return nil, errors.New("single embed failed")
	}
	runtime.KeepAlive(ids)
	runtime.KeepAlive(out)
	return out, nil
}
func (e *engine) batch(items []fixture) ([][]float32, error) {
	var packed []int32
	lens := make([]int32, len(items))
	for i, item := range items {
		lens[i] = int32(len(item.IDs))
		packed = append(packed, item.IDs...)
	}
	flat := make([]float32, len(items)*768)
	if len(items) == 0 || C.embed_batch(e.handle, (*C.int32_t)(unsafe.Pointer(&packed[0])), (*C.int32_t)(unsafe.Pointer(&lens[0])), C.size_t(len(items)), (*C.float)(unsafe.Pointer(&flat[0]))) != 0 {
		return nil, errors.New("batch embed failed")
	}
	runtime.KeepAlive(packed)
	runtime.KeepAlive(lens)
	runtime.KeepAlive(flat)
	out := make([][]float32, len(items))
	for i := range out {
		out[i] = flat[i*768 : (i+1)*768]
	}
	return out, nil
}

func cosine(a []float32, b []float64) float64 {
	var dot, aa, bb float64
	for i := range a {
		dot += float64(a[i]) * b[i]
		aa += float64(a[i]) * float64(a[i])
		bb += b[i] * b[i]
	}
	return dot / math.Sqrt(aa*bb)
}
func maxAbsDiff(a []float32, b []float64) float64 {
	var max float64
	for i := range a {
		d := math.Abs(float64(a[i]) - b[i])
		if d > max {
			max = d
		}
	}
	return max
}

type service struct {
	fixtures   []fixture
	queue      chan request
	engine     *engine
	delay      time.Duration
	count      atomic.Int64
	batchCalls atomic.Int64
}

func (s *service) run() {
	for first := range s.queue {
		batch := []request{first}
		timer := time.NewTimer(s.delay)
	collect:
		for len(batch) < 100 {
			select {
			case r := <-s.queue:
				batch = append(batch, r)
			case <-timer.C:
				break collect
			}
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		items := make([]fixture, len(batch))
		for i, r := range batch {
			items[i] = s.fixtures[r.Index]
		}
		vectors, err := s.engine.batch(items)
		s.count.Add(int64(len(batch)))
		s.batchCalls.Add(1)
		for i, r := range batch {
			r.Done <- response{Vector: vectorsAt(vectors, i), Err: err}
		}
	}
}
func vectorsAt(v [][]float32, i int) []float32 {
	if i < len(v) {
		return v[i]
	}
	return nil
}

func (s *service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/embed" {
		http.NotFound(w, r)
		return
	}
	var input struct {
		Index int `json:"index"`
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 1024))
	if err := dec.Decode(&input); err != nil || input.Index < 0 || input.Index >= len(s.fixtures) {
		http.Error(w, "invalid fixture index", http.StatusBadRequest)
		return
	}
	item := request{Index: input.Index, Done: make(chan response, 1)}
	select {
	case s.queue <- item:
	case <-r.Context().Done():
		return
	}
	select {
	case result := <-item.Done:
		if result.Err != nil {
			http.Error(w, "embedding failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(embedding{Text: s.fixtures[input.Index].Text, Vector: result.Vector})
	case <-r.Context().Done():
	}
}

func load(path string) (reference, error) {
	b, err := os.ReadFile(path)
	var v reference
	if err == nil {
		err = json.Unmarshal(b, &v)
	}
	return v, err
}
func percentile(sorted []float64, p float64) float64 {
	return sorted[int(math.Ceil(p*float64(len(sorted))))-1]
}

func commonEngine(handle unsafe.Pointer) *engine {
	if handle == nil {
		return nil
	}
	return cgo.Handle(C.go_handle_id(handle)).Value().(*engine)
}

//export ib_engine_init
func ib_engine_init(modelPath *C.char) unsafe.Pointer {
	if modelPath == nil {
		return nil
	}
	libPath := os.Getenv("IB_MOJO_LIBRARY")
	if libPath == "" {
		return nil
	}
	e, err := newEngine(libPath, C.GoString(modelPath))
	if err != nil {
		return nil
	}
	id := cgo.NewHandle(e)
	handle := C.go_handle_new(C.uintptr_t(id))
	if handle == nil {
		e.close()
		id.Delete()
		return nil
	}
	return handle
}

//export ib_engine_embed
func ib_engine_embed(handle unsafe.Pointer, tokens *C.int32_t, n C.size_t, out *C.float) C.int {
	if handle == nil || tokens == nil || out == nil || n == 0 || n > 2048 {
		return -1
	}
	ids := unsafe.Slice((*int32)(unsafe.Pointer(tokens)), int(n))
	vector, err := commonEngine(handle).single(ids)
	if err != nil {
		return -2
	}
	copy(unsafe.Slice((*float32)(unsafe.Pointer(out)), 768), vector)
	runtime.KeepAlive(ids)
	runtime.KeepAlive(vector)
	return 0
}

//export ib_engine_embed_batch
func ib_engine_embed_batch(handle unsafe.Pointer, tokens *C.int32_t, lens *C.size_t, nseq C.size_t, out *C.float) C.int {
	if handle == nil || tokens == nil || lens == nil || out == nil || nseq == 0 || nseq > 100 {
		return -1
	}
	lengths := unsafe.Slice((*C.size_t)(unsafe.Pointer(lens)), int(nseq))
	total := 0
	for _, n := range lengths {
		if n == 0 || n > 2048 || uint64(n) > uint64(16384-total) {
			return -1
		}
		total += int(n)
	}
	packed := unsafe.Slice((*C.int32_t)(unsafe.Pointer(tokens)), total)
	items := make([]fixture, len(lengths))
	offset := 0
	for i, n := range lengths {
		end := offset + int(n)
		items[i].IDs = append([]int32(nil), unsafe.Slice((*int32)(unsafe.Pointer(&packed[offset])), end-offset)...)
		offset = end
	}
	vectors, err := commonEngine(handle).batch(items)
	if err != nil {
		return -2
	}
	result := unsafe.Slice((*float32)(unsafe.Pointer(out)), 768*len(vectors))
	for i, vector := range vectors {
		copy(result[i*768:(i+1)*768], vector)
	}
	runtime.KeepAlive(packed)
	runtime.KeepAlive(items)
	runtime.KeepAlive(vectors)
	return 0
}

//export ib_engine_free
func ib_engine_free(handle unsafe.Pointer) {
	if handle == nil {
		return
	}
	id := cgo.Handle(C.go_handle_id(handle))
	commonEngine(handle).close()
	id.Delete()
	C.go_handle_free(handle)
}

//export ib_engine_name
func ib_engine_name() *C.char { return (*C.char)(unsafe.Pointer(C.go_engine_name())) }

func serveBench(addr string, s *service, workers, perWorker int, raw *csv.Writer, run string) error {
	server := &http.Server{Addr: addr, Handler: s, ReadHeaderTimeout: 3 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
		}
	}()
	client := &http.Client{Timeout: 30 * time.Second}
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		resp, err := client.Get("http://" + addr + "/health")
		if err == nil {
			resp.Body.Close()
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	var wg sync.WaitGroup
	latencies := make([]float64, 0, workers*perWorker)
	var mu sync.Mutex
	errs := make(chan error, workers)
	start := time.Now()
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			local := make([]float64, 0, perWorker)
			for j := 0; j < perWorker; j++ {
				payload, _ := json.Marshal(map[string]int{"index": (worker*perWorker + j) % len(s.fixtures)})
				began := time.Now()
				req, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/embed", bytes.NewReader(payload))
				req.Header.Set("Content-Type", "application/json")
				resp, err := client.Do(req)
				if err != nil {
					errs <- err
					return
				}
				_, err = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if err != nil || resp.StatusCode != 200 {
					errs <- fmt.Errorf("HTTP %v: %v", resp.StatusCode, err)
					return
				}
				local = append(local, float64(time.Since(began).Microseconds())/1000)
			}
			mu.Lock()
			latencies = append(latencies, local...)
			mu.Unlock()
		}(w)
	}
	wg.Wait()
	elapsed := time.Since(start)
	close(errs)
	for err := range errs {
		if err != nil {
			_ = server.Close()
			return err
		}
	}
	_ = server.Close()
	sort.Float64s(latencies)
	fmt.Printf("http_concurrent workers=%d requests=%d throughput_rps=%.1f p50_ms=%.3f p95_ms=%.3f queue_window_ms=%.1f batch_calls=%d requests_processed=%d\n", workers, len(latencies), float64(len(latencies))/elapsed.Seconds(), percentile(latencies, .50), percentile(latencies, .95), float64(s.delay.Microseconds())/1000, s.batchCalls.Load(), s.count.Load())
	if raw != nil {
		for i, ms := range latencies {
			_ = raw.Write([]string{run, "http", fmt.Sprint(i), fmt.Sprintf("%.6f", ms)})
		}
		raw.Flush()
	}
	return nil
}

func main() {
	lib := flag.String("lib", "", "Mojo GPU C ABI dylib")
	model := flag.String("model", "", "converted Mojo model weights")
	refPath := flag.String("reference", "", "fresh Q8 reference JSON from reference binary")
	workers := flag.Int("workers", 32, "concurrent HTTP clients")
	perWorker := flag.Int("requests", 50, "requests per client")
	window := flag.Duration("window", 3*time.Millisecond, "batch collection delay")
	addr := flag.String("addr", "127.0.0.1:8788", "local benchmark HTTP address")
	rawPath := flag.String("raw-csv", "", "append raw per-call timings to CSV")
	runID := flag.String("run", "go", "run label for raw CSV")
	flag.Parse()
	if *lib == "" || *model == "" || *refPath == "" {
		log.Fatal("-lib -model -reference required")
	}
	ref, err := load(*refPath)
	if err != nil || len(ref.Rows) != 20 {
		log.Fatalf("reference must contain 20 rows: %v", err)
	}
	e, err := newEngine(*lib, *model)
	if err != nil {
		log.Fatal(err)
	}
	defer e.close()
	var rawFile *os.File
	var raw *csv.Writer
	if *rawPath != "" {
		rawFile, err = os.Create(*rawPath)
		if err != nil {
			log.Fatal(err)
		}
		defer rawFile.Close()
		raw = csv.NewWriter(rawFile)
		_ = raw.Write([]string{"run", "kind", "iteration", "ms"})
	}
	min := 1.0
	mean, maxDiff := 0.0, 0.0
	for i, f := range ref.Rows {
		v, err := e.single(f.IDs)
		if err != nil {
			log.Fatal(err)
		}
		cos := cosine(v, f.Vector)
		if cos < min {
			min = cos
		}
		if cos < .999 {
			log.Fatalf("fixture %d cosine %.9f below gate", i, cos)
		}
		mean += cos
		maxDiff = math.Max(maxDiff, maxAbsDiff(v, f.Vector))
		if raw != nil {
			_ = raw.Write([]string{*runID, "single_cosine", fmt.Sprint(i), fmt.Sprintf("%.12f", cos)})
			_ = raw.Write([]string{*runID, "single_max_abs_diff", fmt.Sprint(i), fmt.Sprintf("%.12f", maxAbsDiff(v, f.Vector))})
		}
	}
	mean /= float64(len(ref.Rows))
	batch20, err := e.batch(ref.Rows)
	if err != nil {
		log.Fatal(err)
	}
	batchMin, batchMean, batchMaxDiff := 1.0, 0.0, 0.0
	for i, v := range batch20 {
		f := ref.Rows[i]
		c := cosine(v, f.Vector)
		batchMin = math.Min(batchMin, c)
		batchMean += c
		batchMaxDiff = math.Max(batchMaxDiff, maxAbsDiff(v, f.Vector))
		if c < .999 {
			log.Fatalf("mixed batch fixture %d cosine %.9f below gate", i, c)
		}
		if raw != nil {
			_ = raw.Write([]string{*runID, "batch_cosine", fmt.Sprint(i), fmt.Sprintf("%.12f", c)})
		}
	}
	batchMean /= float64(len(batch20))
	fmt.Printf("cosine_min_q8=%.9f mean=%.9f max_abs_diff=%.9f mixed_batch_min=%.9f mixed_batch_mean=%.9f mixed_batch_max_abs_diff=%.9f fixtures=%d\n", min, mean, maxDiff, batchMin, batchMean, batchMaxDiff, len(ref.Rows))
	if raw != nil {
		raw.Flush()
	}
	ids := ref.Rows[0].IDs
	times := make([]float64, 31)
	out := make([]float32, 768)
	for i := 0; i < 31; i++ {
		began := time.Now()
		if C.embed(e.handle, (*C.int32_t)(unsafe.Pointer(&ids[0])), C.size_t(len(ids)), (*C.float)(unsafe.Pointer(&out[0]))) != 0 {
			log.Fatal("embed failed")
		}
		runtime.KeepAlive(ids)
		runtime.KeepAlive(out)
		times[i] = float64(time.Since(began).Microseconds()) / 1000
	}
	sort.Float64s(times[1:])
	singleMedian := (times[15] + times[16]) / 2
	fmt.Printf("go_cgo_mojo_single tokens=%d warm_median_ms=%.3f p95_ms=%.3f\n", len(ids), singleMedian, percentile(times[1:], .95))
	if raw != nil {
		for i, ms := range times[1:] {
			_ = raw.Write([]string{*runID, "single", fmt.Sprint(i), fmt.Sprintf("%.6f", ms)})
		}
		raw.Flush()
	}
	items := make([]fixture, 100)
	for i := range items {
		items[i] = ref.Rows[0]
	}
	for range 3 {
		if _, err := e.batch(items); err != nil {
			log.Fatal(err)
		}
	}
	batchRates := make([]float64, 3)
	for i := range 3 {
		started := time.Now()
		if _, err := e.batch(items); err != nil {
			log.Fatal(err)
		}
		batchRates[i] = 100 / time.Since(started).Seconds()
	}
	batchPS := (batchRates[0] + batchRates[1] + batchRates[2]) / 3
	fmt.Printf("go_cgo_mojo_batch100 paragraphs_per_second=%.1f\n", batchPS)
	if raw != nil {
		for i, rate := range batchRates {
			_ = raw.Write([]string{*runID, "batch100_paragraphs_per_second", fmt.Sprint(i), fmt.Sprintf("%.6f", rate)})
		}
		raw.Flush()
	}
	var noop int
	t0 := time.Now()
	for i := 0; i < 1_000_000; i++ {
		noop += int(C.noop())
	}
	fmt.Printf("cgo_noop_ns_per_call=%.1f calls=%d checksum=%d\n", float64(time.Since(t0).Nanoseconds())/1e6, 1_000_000, noop)
	s := &service{fixtures: ref.Rows, queue: make(chan request, 10000), engine: e, delay: *window}
	go s.run()
	if err := serveBench(*addr, s, *workers, *perWorker, raw, *runID); err != nil {
		log.Fatal(err)
	}
}
