# SPDX-License-Identifier: Apache-2.0
"""Observe command IDs and encoder/GPU intervals; do not infer them from source."""
import collections
import csv
import hashlib
import json
from pathlib import Path
import statistics
import sys
import xml.etree.ElementTree as ET

encoder_path, gpu_path, stdout_path, target = map(Path, sys.argv[1:])


def read(path, expected_schema):
    root = ET.parse(path).getroot()
    ids = {e.attrib["id"]: e for e in root.iter() if "id" in e.attrib}

    def resolve(e):
        while "ref" in e.attrib:
            e = ids[e.attrib["ref"]]
        return e

    rows = []
    for node in root.findall("node"):
        schema = node.find("schema")
        if schema is None or schema.attrib.get("name") != expected_schema:
            continue
        columns = [c.findtext("mnemonic") for c in schema.findall("col")]
        for row in node.findall("row"):
            cells = [resolve(e) for e in row]
            rows.append({k: dict(fmt=e.attrib.get("fmt", e.text or ""), raw=e.text or "")
                         for k, e in zip(columns, cells)})
    return rows


cpu = [r for r in read(encoder_path, "metal-application-encoders-list")
       if r["cmdbuffer-label"]["fmt"] == "E1 paragraph forward"]
cpu.sort(key=lambda r: int(r["start"]["raw"]))
counts = collections.Counter(r["cmdbuffer-id"]["raw"] for r in cpu)
assert len(cpu) == len(counts) == 40
assert set(counts.values()) == {1}
gpu = collections.defaultdict(list)
selected = []
for row in read(gpu_path, "metal-gpu-intervals"):
    if row["cmdbuffer-id"]["raw"] in counts and row["state"]["fmt"] == "Active":
        gpu[row["cmdbuffer-id"]["raw"]].append(row)
        selected.append(row)
# Preserve only this experiment's GPU rows, without unrelated app/device metadata.
excerpt = ET.Element("trace-query-result", source_sha256=hashlib.sha256(gpu_path.read_bytes()).hexdigest())
node = ET.SubElement(excerpt, "node")
schema = ET.SubElement(node, "schema", name="metal-gpu-intervals")
for key in selected[0]:
    ET.SubElement(ET.SubElement(schema, "col"), "mnemonic").text = key
for record in selected:
    row = ET.SubElement(node, "row")
    for cell in record.values():
        ET.SubElement(row, "value", fmt=cell["fmt"]).text = cell["raw"]
ET.ElementTree(excerpt).write(target.with_name("trace-gpu-selected.xml"), encoding="utf-8", xml_declaration=True)
assert set(gpu) == set(counts)
intervals = []
for i, row in enumerate(cpu):
    cb = row["cmdbuffer-id"]["raw"]
    spans = gpu[cb]
    begin = min(int(r["start"]["raw"]) for r in spans)
    end = max(int(r["start"]["raw"]) + int(r["duration"]["raw"]) for r in spans)
    active = sum(int(r["duration"]["raw"]) for r in spans)
    encoding = int(row["duration"]["raw"])
    gap = begin - int(row["start"]["raw"]) - encoding
    assert gap >= 0 and end - begin >= active
    intervals.append(dict(call=i, phase="warmup" if i < 10 else "measured", command_buffer_id=cb,
                          encoder_cpu_ms=encoding/1e6, encode_end_to_gpu_start_ms=gap/1e6,
                          gpu_active_ms=active/1e6, gpu_span_ms=(end-begin)/1e6,
                          gpu_span_gap_ms=(end-begin-active)/1e6, encoder_to_gpu_end_ms=(end-int(row["start"]["raw"]))/1e6, active_segments=len(spans)))
with target.with_suffix(".csv").open("w") as stream:
    writer = csv.DictWriter(stream, fieldnames=list(intervals[0]))
    writer.writeheader()
    writer.writerows(intervals)
program = json.loads(stdout_path.read_text())
assert program["calls"] == 40 and program["command_buffers_per_call"] == program["encoders_per_call"] == 1
result = dict(calls=40, warmups=10, measured=30, command_buffers=len(counts), compute_encoders=len(cpu),
              command_buffers_per_paragraph=1, encoders_per_paragraph=1,
              dispatches_per_paragraph=program["dispatches_per_call"],
              instrumented_wall_median_ms=program["median_ms"],
              evidence="Metal System Trace observed unique command buffer/encoder IDs; dispatches are host counter",
              interval_medians_ms={key: statistics.median(r[key] for r in intervals[10:])
                                   for key in ("encoder_cpu_ms", "encode_end_to_gpu_start_ms", "gpu_active_ms", "gpu_span_ms", "gpu_span_gap_ms", "encoder_to_gpu_end_ms")},
              limitation="Encoder duration is CPU recording; GPU Active intervals are traced intervals, not sampled shader time. Medians do not add up to wall median.")
target.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
