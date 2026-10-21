// SPDX-License-Identifier: Apache-2.0
// Exercise the adapter's shape policy using real compiled-model descriptions.
#include "engine.mm"
int main(int argc, const char **argv) { @autoreleasepool {
    if (argc != 4) return 2;
    NSMutableArray *records = [NSMutableArray new];
    bool passed = true;
    for (int i = 0; i < 2; ++i) {
        setenv("IB_COREML_COMPUTE_UNITS", i == 0 ? "CPU_AND_NE" : "CPU_AND_GPU", 1);
        Engine *e = static_cast<Engine *>(ib_engine_init(argv[i+1]));
        if (!e) return 3;
        NSMutableDictionary *record = [@{@"mode": i == 0 ? @"static82" : @"enumerated512",
            @"selected_fixed_length": @(e->fixed_length), @"selected_max_batch": @(e->max_batch)} mutableCopy];
        for (NSString *name in @[@"ids", @"valid"]) {
            MLMultiArrayConstraint *c = e->model.modelDescription.inputDescriptionsByName[name].multiArrayConstraint;
            record[name] = @{@"shape":c.shape, @"constraint_type":@(c.shapeConstraint.type),
                @"enumerated_shapes":c.shapeConstraint.enumeratedShapes ?: @[]};
        }
        const bool decision = i == 0 ? (e->fixed_length == 82 && e->max_batch == 1) : (e->fixed_length == 0 && e->max_batch == 4);
        record[@"decision_passed"] = @(decision);
        passed = passed && decision;
        if (decision) {
            int32_t tokens[513] = {}; float out[768] = {}; size_t n = i == 0 ? 83 : 513;
            bool bounds = ib_engine_embed(e, tokens, n, out) == -1 && ib_engine_embed_batch(e, tokens, &n, 1, out) == -1;
            record[@"oversize_single_batch_rejected"] = @(bounds); passed = passed && bounds;
        }
        [records addObject:record]; ib_engine_free(e);
    }
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:records options:NSJSONWritingPrettyPrinted error:&error];
    if (!json) return 4;
    fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
    return strcmp(argv[3], "describe") == 0 ? 0 : (passed ? 0 : 1);
}}
