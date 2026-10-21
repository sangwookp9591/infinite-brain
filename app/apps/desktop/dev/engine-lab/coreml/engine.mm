// SPDX-License-Identifier: Apache-2.0
// Core ML owns scheduling; this adapter only packs independent sequences and normalizes output.
#import <CoreML/CoreML.h>
#import <Foundation/Foundation.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <mutex>
#include <vector>

struct Inputs {
    MLMultiArray *ids;
    MLMultiArray *valid;
    id<MLFeatureProvider> provider;
};
struct Engine {
    MLModel *model;
    size_t fixed_length = 0;
    size_t max_batch = 4;
    std::mutex mutex;
    std::map<std::pair<size_t, size_t>, Inputs> inputs;
};

extern "C" const char *ib_engine_name() {
    const char *unit = getenv("IB_COREML_COMPUTE_UNITS");
    if (unit && strcmp(unit, "CPU_AND_NE") == 0) return "coreml-fp16-cpu-ane";
    if (unit && strcmp(unit, "CPU_AND_GPU") == 0) return "coreml-fp16-cpu-gpu";
    return "coreml-fp16-all";
}

extern "C" void *ib_engine_init(const char *path) {
    if (!path) return nullptr;
    @autoreleasepool {
        NSString *p = [NSString stringWithUTF8String:path];
        if (!p || ![NSFileManager.defaultManager fileExistsAtPath:p]) return nullptr;
        MLModelConfiguration *config = [MLModelConfiguration new];
        const char *choice = getenv("IB_COREML_COMPUTE_UNITS");
        if (!choice || strcmp(choice, "ALL") == 0) config.computeUnits = MLComputeUnitsAll;
        else if (strcmp(choice, "CPU_AND_GPU") == 0) config.computeUnits = MLComputeUnitsCPUAndGPU;
        else if (strcmp(choice, "CPU_AND_NE") == 0) config.computeUnits = MLComputeUnitsCPUAndNeuralEngine;
        else return nullptr;
        NSError *error = nil;
        MLModel *model = [MLModel modelWithContentsOfURL:[NSURL fileURLWithPath:p] configuration:config error:&error];
        if (!model) {
            fprintf(stderr, "Core ML init: %s\n", error.localizedDescription.UTF8String);
            return nullptr;
        }
        Engine *e = new Engine;
        e->model = model;
        MLMultiArrayConstraint *constraint = model.modelDescription.inputDescriptionsByName[@"ids"].multiArrayConstraint;
        if (constraint.shape.count == 2 && constraint.shape[0].intValue == 1 && constraint.shape[1].intValue == 82
            && (constraint.shapeConstraint.type != MLMultiArrayShapeConstraintTypeEnumerated
                || constraint.shapeConstraint.enumeratedShapes.count == 1)) {
            e->fixed_length = 82;
            e->max_batch = 1;
        }
        return e;
    }
}

static int predict(Engine *e, const int32_t *tokens, const size_t *lengths, size_t count, float *out) {
    @autoreleasepool {
        size_t longest = *std::max_element(lengths, lengths + count);
        size_t length = e->fixed_length ? e->fixed_length : 64;
        while (length < longest) length *= 2;
        size_t batch = e->fixed_length ? 1 : (count == 1 ? 1 : 4);
        auto key = std::make_pair(batch, length);
        auto it = e->inputs.find(key);
        if (it == e->inputs.end()) {
            NSError *error = nil;
            NSArray<NSNumber *> *shape = @[@(batch), @(length)];
            MLMultiArray *ids = [[MLMultiArray alloc] initWithShape:shape dataType:MLMultiArrayDataTypeInt32 error:&error];
            MLMultiArray *valid = [[MLMultiArray alloc] initWithShape:shape dataType:MLMultiArrayDataTypeFloat32 error:&error];
            if (!ids || !valid) return -4;
            MLDictionaryFeatureProvider *provider = [[MLDictionaryFeatureProvider alloc]
                initWithDictionary:@{@"ids": ids, @"valid": valid} error:&error];
            if (!provider) return -4;
            it = e->inputs.emplace(key, Inputs{ids, valid, provider}).first;
        }
        Inputs &in = it->second;
        int32_t *ids = static_cast<int32_t *>(in.ids.dataPointer);
        float *valid = static_cast<float *>(in.valid.dataPointer);
        std::fill(ids, ids + batch * length, 0);
        std::fill(valid, valid + batch * length, 0.f);
        for (size_t seq = 0; seq < batch; ++seq) {
            if (seq < count) {
                std::copy(tokens, tokens + lengths[seq], ids + seq * length);
                std::fill(valid + seq * length, valid + seq * length + lengths[seq], 1.f);
                tokens += lengths[seq];
            } else valid[seq * length] = 1.f;
        }
        NSError *error = nil;
        id<MLFeatureProvider> result = [e->model predictionFromFeatures:in.provider error:&error];
        MLMultiArray *embedding = [result featureValueForName:@"embedding"].multiArrayValue;
        if (!embedding || embedding.dataType != MLMultiArrayDataTypeFloat32 || embedding.shape.count != 2
            || embedding.shape[0].unsignedLongLongValue != batch || embedding.shape[1].intValue != 768) {
            fprintf(stderr, "Core ML prediction failed: %s\n", error.localizedDescription.UTF8String ?: "invalid output shape/type");
            return -4;
        }
        const float *data = static_cast<const float *>(embedding.dataPointer);
        size_t s0 = embedding.strides[0].unsignedLongLongValue, s1 = embedding.strides[1].unsignedLongLongValue;
        for (size_t seq = 0; seq < count; ++seq) {
            double norm = 0;
            for (size_t j = 0; j < 768; ++j) {
                float x = data[seq * s0 + j * s1];
                if (!std::isfinite(x)) return -3;
                norm += double(x) * x;
            }
            if (!(norm > 0) || !std::isfinite(norm)) return -3;
            norm = std::sqrt(norm);
            for (size_t j = 0; j < 768; ++j) out[seq * 768 + j] = data[seq * s0 + j * s1] / norm;
        }
        return 0;
    }
}

extern "C" int ib_engine_embed_batch(void *handle, const int32_t *tokens, const size_t *lengths, size_t count, float *out) {
    if (!handle || !tokens || !lengths || !out || !count || count > 100) return -1;
    Engine *e = static_cast<Engine *>(handle);
    size_t limit = e->fixed_length ? e->fixed_length : 512;
    size_t total = 0;
    for (size_t i = 0; i < count; ++i) {
        if (!lengths[i] || lengths[i] > limit || total + lengths[i] > 16384) return -1;
        total += lengths[i];
    }
    for (size_t i = 0; i < total; ++i) if (tokens[i] < 0 || tokens[i] >= 262144) return -2;
    std::lock_guard<std::mutex> guard(e->mutex);
    size_t offset = 0;
    for (size_t first = 0; first < count; first += e->max_batch) {
        size_t n = std::min(e->max_batch, count - first);
        int status = predict(e, tokens + offset, lengths + first, n, out + first * 768);
        if (status) return status;
        for (size_t i = 0; i < n; ++i) offset += lengths[first + i];
    }
    return 0;
}

extern "C" int ib_engine_embed(void *e, const int32_t *tokens, size_t n, float *out) {
    return ib_engine_embed_batch(e, tokens, &n, 1, out);
}
extern "C" int ib_engine_stats(void *, uint32_t *buffers, uint32_t *dispatches) {
    if (buffers) *buffers = UINT32_MAX;
    if (dispatches) *dispatches = UINT32_MAX;
    return -1; // Core ML does not expose runtime command-buffer/dispatch counters.
}
extern "C" void ib_engine_free(void *e) { delete static_cast<Engine *>(e); }
