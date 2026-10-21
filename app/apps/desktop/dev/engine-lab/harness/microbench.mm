// SPDX-License-Identifier: Apache-2.0
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <MetalPerformanceShaders/MetalPerformanceShaders.h>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cmath>
using Clock=std::chrono::steady_clock;
static double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
static void done(id<MTLCommandBuffer> b){[b waitUntilCompleted];if(b.status==MTLCommandBufferStatusError){fprintf(stderr,"Metal: %s\n",b.error.description.UTF8String);exit(2);}}
int main(int argc,const char **argv){@autoreleasepool{
    if(argc!=2)return 2;
    FILE *f=fopen(argv[1],"w");if(!f)return 2;
    fprintf(f,"kind,size,depth,iteration,host_ms,gpu_ms,gb_s,tflops,cpu_submit_us\n");
    id<MTLDevice>d=MTLCreateSystemDefaultDevice();if(!d)return 2;
    // 512 slots permit testing queue depth 256 without the default 64-slot allocation stall.
    id<MTLCommandQueue>q=[d newCommandQueueWithMaxCommandBufferCount:512];
    const size_t bytes=128*1024*1024;
    id<MTLBuffer>a=[d newBufferWithLength:bytes options:MTLResourceStorageModeShared];
    id<MTLBuffer>b=[d newBufferWithLength:bytes options:MTLResourceStorageModeShared];
    if(!a||!b)return 2;memset(a.contents,0x37,bytes);memset(b.contents,0,bytes);
    for(int it=-5;it<30;it++){@autoreleasepool{
        id<MTLCommandBuffer>cb=[q commandBuffer];id<MTLBlitCommandEncoder>enc=[cb blitCommandEncoder];
        for(int k=0;k<8;k++)[enc copyFromBuffer:(k%2?b:a) sourceOffset:0 toBuffer:(k%2?a:b) destinationOffset:0 size:bytes];
        [enc endEncoding];auto t=Clock::now();[cb commit];done(cb);double host=ms(t),gpu=(cb.GPUEndTime-cb.GPUStartTime)*1000;
        if(it>=0)fprintf(f,"copy,%zu,1,%d,%.9f,%.9f,%.9f,0,0\n",bytes,it,host,gpu,2.0*bytes*8/(gpu*1e6));
    }}
    if(((unsigned char*)b.contents)[bytes-1]!=0x37)return 3;
    for(int n:{1024,2048,4096}){@autoreleasepool{
        size_t sz=(size_t)n*n*sizeof(_Float16);
        id<MTLBuffer>aa=[d newBufferWithLength:sz options:MTLResourceStorageModeShared];
        id<MTLBuffer>bb=[d newBufferWithLength:sz options:MTLResourceStorageModeShared];
        id<MTLBuffer>cc=[d newBufferWithLength:sz options:MTLResourceStorageModeShared];
        for(size_t i=0;i<(size_t)n*n;i++){((_Float16*)aa.contents)[i]=0.5;((_Float16*)bb.contents)[i]=0.5;}
        MPSMatrixDescriptor*desc=[MPSMatrixDescriptor matrixDescriptorWithRows:n columns:n rowBytes:n*2 dataType:MPSDataTypeFloat16];
        MPSMatrix*ma=[[MPSMatrix alloc]initWithBuffer:aa descriptor:desc];MPSMatrix*mb=[[MPSMatrix alloc]initWithBuffer:bb descriptor:desc];MPSMatrix*mc=[[MPSMatrix alloc]initWithBuffer:cc descriptor:desc];
        MPSMatrixMultiplication*gemm=[[MPSMatrixMultiplication alloc]initWithDevice:d transposeLeft:NO transposeRight:NO resultRows:n resultColumns:n interiorColumns:n alpha:1 beta:0];
        for(int it=-5;it<30;it++){@autoreleasepool{
            id<MTLCommandBuffer>cb=[q commandBuffer];[gemm encodeToCommandBuffer:cb leftMatrix:ma rightMatrix:mb resultMatrix:mc];auto t=Clock::now();[cb commit];done(cb);double host=ms(t),gpu=(cb.GPUEndTime-cb.GPUStartTime)*1000;
            if(it>=0)fprintf(f,"gemm,%d,1,%d,%.9f,%.9f,0,%.9f,0\n",n,it,host,gpu,2.0*n*n*n/(gpu*1e9));
        }}
        float val=(float)((_Float16*)cc.contents)[0];if(!std::isfinite(val)||fabs(val-n*0.25)>n*0.002){fprintf(stderr,"GEMM validation %g\n",val);return 3;}
    }}
    NSError*err=nil;NSString*src=@"#include <metal_stdlib>\nusing namespace metal; kernel void tiny(device uint *v [[buffer(0)]], uint i [[thread_position_in_grid]]) {v[i]=i+1;}";
    id<MTLLibrary>lib=[d newLibraryWithSource:src options:nil error:&err];if(!lib){fprintf(stderr,"%s\n",err.description.UTF8String);return 2;}
    id<MTLComputePipelineState>pipeline=[d newComputePipelineStateWithFunction:[lib newFunctionWithName:@"tiny"] error:&err];if(!pipeline)return 2;
    for(int depth=1;depth<=256;depth++)for(int it=-5;it<30;it++){@autoreleasepool{
        NSMutableArray<id<MTLCommandBuffer>>*buffers=[NSMutableArray arrayWithCapacity:depth];
        for(int k=0;k<depth;k++){
            id<MTLCommandBuffer>cb=[q commandBuffer];id<MTLComputeCommandEncoder>enc=[cb computeCommandEncoder];[enc setComputePipelineState:pipeline];[enc setBuffer:b offset:k*256 atIndex:0];[enc dispatchThreads:MTLSizeMake(1,1,1) threadsPerThreadgroup:MTLSizeMake(1,1,1)];[enc endEncoding];[buffers addObject:cb];
        }
        auto t=Clock::now();for(id<MTLCommandBuffer>cb in buffers)[cb commit];double submit=ms(t)*1000/depth;
        done(buffers.lastObject);double host=ms(t),gpu=(buffers.lastObject.GPUEndTime-buffers.firstObject.GPUStartTime)*1000;
        if(it>=0)fprintf(f,"submit,1,%d,%d,%.9f,%.9f,0,0,%.9f\n",depth,it,host,gpu,submit);
    }}
    fclose(f);fprintf(stderr,"Metal microbench complete: %s\n",d.name.UTF8String);return 0;
}}
