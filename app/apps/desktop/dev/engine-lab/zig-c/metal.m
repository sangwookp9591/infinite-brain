// SPDX-License-Identifier: Apache-2.0
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#ifndef IB_SPLIT_DEFAULT
#define IB_SPLIT_DEFAULT 0
#endif
unsigned mh_split_enabled(void) { return IB_SPLIT_DEFAULT || getenv("IB_ZIG_SPLIT") != NULL; }

typedef struct { id<MTLDevice> device; id<MTLCommandQueue> queue;
    id<MTLLibrary> library; NSMutableDictionary *pipelines;
    id<MTLCommandBuffer> command; id<MTLComputeCommandEncoder> encoder;
    unsigned dispatches, commands; double gpu_seconds; } Host;

void *mh_create(const char *source) {
    @autoreleasepool {
        Host *h = calloc(1, sizeof(Host));
        h->device = MTLCreateSystemDefaultDevice();
        h->queue = [h->device newCommandQueue];
        NSError *error = nil;
        h->library = [h->device newLibraryWithSource:[NSString stringWithUTF8String:source]
            options:nil error:&error];
        if (!h->library || !h->queue) { fprintf(stderr, "Metal: %s\n", error.description.UTF8String); [h->library release]; [h->queue release]; [h->device release]; free(h); return NULL; }
        h->pipelines = [NSMutableDictionary new];
        return h;
    }
}
void mh_free(void *host) {
    Host *h = host;
    if (!h) return;
    [h->pipelines release]; [h->library release]; [h->queue release]; [h->device release]; free(h);
}
void *mh_buffer(void *host, size_t bytes) {
    return [((Host *)host)->device newBufferWithLength:bytes options:MTLResourceStorageModeShared];
}
void mh_release(void *buffer) { [(id)buffer release]; }
void *mh_contents(void *buffer) { return [(id<MTLBuffer>)buffer contents]; }
int mh_begin(void *host) {
    @autoreleasepool {
    Host *h = host;
    h->command = [[h->queue commandBuffer] retain];
    h->encoder = [[h->command computeCommandEncoder] retain];
    h->dispatches = 0;
    h->commands = 1;
    return h->encoder != nil;
    }
}
int mh_dispatch(void *host, const char *name, void **buffers, const size_t *offsets,
                unsigned count, const unsigned *params, unsigned gx, unsigned gy, unsigned threads) {
    @autoreleasepool {
    Host *h = host;
    // Same kernels and buffers; only submission granularity changes in this ablation.
    if (mh_split_enabled() && h->dispatches) {
        [h->encoder endEncoding]; [h->encoder release];
        [h->command commit]; [h->command release];
        h->command = [[h->queue commandBuffer] retain];
        h->encoder = [[h->command computeCommandEncoder] retain];
        h->commands++;
    }
    NSString *key = [NSString stringWithUTF8String:name];
    id<MTLComputePipelineState> pipeline = h->pipelines[key];
    if (!pipeline) {
        NSError *error = nil;
        id<MTLFunction> fn = [h->library newFunctionWithName:key];
        pipeline = [h->device newComputePipelineStateWithFunction:fn error:&error];
        [fn release];
        if (!pipeline) { fprintf(stderr,"pipeline %s: %s\n",name,error.description.UTF8String); return 0; }
        h->pipelines[key] = pipeline; [pipeline release];
    }
    [h->encoder setComputePipelineState:pipeline];
    for (unsigned i = 0; i < count; i++) [h->encoder setBuffer:buffers[i] offset:offsets[i] atIndex:i];
    [h->encoder setBytes:params length:32 atIndex:count];
    [h->encoder dispatchThreadgroups:MTLSizeMake(gx,gy,1) threadsPerThreadgroup:MTLSizeMake(threads,1,1)];
    if (getenv("IB_ZIG_DEBUG")) {
        [h->encoder endEncoding]; [h->encoder release]; [h->command commit]; [h->command waitUntilCompleted]; [h->command release];
        unsigned target = !strcmp(name,"gather") || !strcmp(name,"l2") ? 0 : !strcmp(name,"attention") ? 3 : !strcmp(name,"pool") ? 1 : 2;
        unsigned length = !strcmp(name,"pool") ? params[5]*512 : !strcmp(name,"l2") ? params[5]*768 : params[0]*params[2];
        if (!strcmp(name,"attention")) length *= 4;
        float *v = (float *)((char *)[(id<MTLBuffer>)buffers[target] contents]+offsets[target]);
        float peak=0;unsigned bad=0;for(unsigned i=0;i<length;i++){if(!isfinite(v[i]))bad++;else peak=fmaxf(peak,fabsf(v[i]));}
        fprintf(stderr,"DEBUG %u %s peak=%g bad=%u first=%g\n",h->dispatches,name,peak,bad,v[0]);
        h->command=[[h->queue commandBuffer] retain];h->encoder=[[h->command computeCommandEncoder] retain];
        h->commands++;
    }
    h->dispatches++;
    return 1;
    }
}
int mh_finish(void *host, int commit) {
    @autoreleasepool {
    Host *h = host;
    [h->encoder endEncoding]; [h->encoder release]; h->encoder = nil;
    int ok = 0;
    if (commit) {
        [h->command commit]; [h->command waitUntilCompleted];
        ok = h->command.status == MTLCommandBufferStatusCompleted;
        h->gpu_seconds = h->command.GPUEndTime-h->command.GPUStartTime;
        if (!ok) fprintf(stderr,"GPU: %s\n",h->command.error.description.UTF8String);
    } else if (mh_split_enabled() && h->dispatches) {
        // Drain previously submitted stages before a failed call may reuse or release buffers.
        id<MTLCommandBuffer> fence = [h->queue commandBuffer];
        [fence commit]; [fence waitUntilCompleted];
    }
    [h->command release]; h->command = nil;
    return ok;
    }
}
unsigned mh_dispatch_count(void *host) { return ((Host *)host)->dispatches; }
unsigned mh_command_count(void *host) { return ((Host *)host)->commands; }
double mh_gpu_seconds(void *host) { return ((Host *)host)->gpu_seconds; }
