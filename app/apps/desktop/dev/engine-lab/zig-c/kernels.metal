// SPDX-License-Identifier: Apache-2.0
// Equations adapted from this repository's Apache-2.0 Mojo spike; no third-party kernel copied.
#include <metal_stdlib>
using namespace metal;
struct P { uint n,k,d,layer,full,count,a,b; };
// tanh is already saturated here; bound its argument to avoid fast-math overflow.
float gelu(float x) { return .5f*x*(1+tanh(clamp(.7978845608028654f*x*(1+.044715f*x*x),-10.f,10.f))); }
kernel void stream_copy(device const float *x [[buffer(0)]],device float *y [[buffer(1)]],
 constant P &p [[buffer(2)]],uint i [[thread_position_in_grid]]) {if(i<p.n)y[i]=x[i];}

kernel void gather(device float *x [[buffer(0)]], device const float *w [[buffer(1)]],
 device const int *ids [[buffer(2)]], constant P &p [[buffer(3)]], uint i [[thread_position_in_grid]]) {
 if(i<p.n*512) x[i]=w[ids[i/512]*512+i%512]*sqrt(512.f);
}
kernel void mm(device const float *x [[buffer(0)]], device const half *w [[buffer(1)]],
 device float *y [[buffer(2)]], constant P &p [[buffer(3)]], uint tid [[thread_index_in_threadgroup]],
 uint sg [[simdgroup_index_in_threadgroup]], uint2 group [[threadgroup_position_in_grid]]) {
 threadgroup half aa[1024],bb[1024];
 simdgroup_float8x8 c00(0),c01(0),c10(0),c11(0);
 uint row=group.y*32,col=group.x*32,sr=(sg/2)*16,sc=(sg%2)*16;
 for(uint kk=0;kk<p.k;kk+=32) {
  for(uint i=tid;i<1024;i+=128) {
   uint r=i/32,c=i%32;
   aa[i]=row+r<p.n && kk+c<p.k ? half(x[(row+r)*p.k+kk+c]) : half(0);
   bb[i]=col+c<p.d && kk+r<p.k ? w[(col+c)*p.k+kk+r] : half(0);
  }
  threadgroup_barrier(mem_flags::mem_threadgroup);
  for(uint k=0;k<32;k+=8) {
   simdgroup_half8x8 a0,a1,b0,b1;
   simdgroup_load(a0,aa+sr*32+k,32); simdgroup_load(a1,aa+(sr+8)*32+k,32);
   simdgroup_load(b0,bb+k*32+sc,32); simdgroup_load(b1,bb+k*32+sc+8,32);
   simdgroup_multiply_accumulate(c00,a0,b0,c00); simdgroup_multiply_accumulate(c01,a0,b1,c01);
   simdgroup_multiply_accumulate(c10,a1,b0,c10); simdgroup_multiply_accumulate(c11,a1,b1,c11);
  }
  threadgroup_barrier(mem_flags::mem_threadgroup);
 }
 threadgroup float out[1024];
 simdgroup_store(c00,out+sr*32+sc,32); simdgroup_store(c01,out+sr*32+sc+8,32);
 simdgroup_store(c10,out+(sr+8)*32+sc,32); simdgroup_store(c11,out+(sr+8)*32+sc+8,32);
 threadgroup_barrier(mem_flags::mem_threadgroup);
 for(uint i=tid;i<1024;i+=128) if(row+i/32<p.n && col+i%32<p.d) y[(row+i/32)*p.d+col+i%32]=out[i];
}
// mode 0 copy norm, 1 in-place scaled PLE norm, 2 residual, 3 scaled residual.
kernel void norm(device const float *x [[buffer(0)]], device const float *w [[buffer(1)]],
 device float *y [[buffer(2)]], device const float *res [[buffer(3)]], device const float *scale [[buffer(4)]],
 constant P &p [[buffer(5)]], uint i [[thread_position_in_grid]], uint lane [[thread_index_in_simdgroup]]) {
 uint r=i/32; if(r>=p.n)return;
 float s=0,pre=p.a==1?rsqrt(512.f):1.f;
 for(uint j=lane;j<p.d;j+=32) {float v=x[r*p.d+j]*pre;s+=v*v;}
 float f=pre*rsqrt(simd_sum(s)/p.d+1e-6f);
 for(uint j=lane;j<p.d;j+=32) {
  uint at=r*p.d+j; float value=x[at]*f*w[j];
  if(p.a>=2)value+=res[at]; if(p.a==3)value*=scale[0];y[at]=value;
 }
}
kernel void rope(device const float *packed [[buffer(0)]], device float *q [[buffer(1)]],
 device float *k [[buffer(2)]], device float *v [[buffer(3)]], device const float *qn [[buffer(4)]],
 device const float *kn [[buffer(5)]], device const int *pos [[buffer(6)]], constant P &p [[buffer(7)]],
 uint i [[thread_position_in_grid]],uint lane [[thread_index_in_simdgroup]]) {
 uint heads=512/p.d,groups=4+2*heads,r=i/32,t=r/groups,h=r%groups;
 if(t>=p.n)return;
 uint source=t*(4*p.d+1024),target=t*4*p.d+h*p.d;
 device float *dest=q; device const float *weight=qn;
 if(h<4) source+=h*p.d;
 else if(h<4+heads) {source+=4*p.d+(h-4)*p.d;target=t*512+(h-4)*p.d;dest=k;weight=kn;}
 else {source+=4*p.d+512+(h-4-heads)*p.d;target=t*512+(h-4-heads)*p.d;dest=v;}
 float ss=0;for(uint j=lane;j<p.d;j+=32){float a=packed[source+j];ss+=a*a;}
 float f=rsqrt(simd_sum(ss)/p.d+1e-6f);
 if(h<4+heads)for(uint j=lane;j<p.d/2;j+=32){
  float angle=pos[t]*pow(p.full?1000000.f:10000.f,-float(2*j)/p.d);
  float a=packed[source+j]*f*weight[j],b=packed[source+j+p.d/2]*f*weight[j+p.d/2];
  dest[target+j]=a*cos(angle)-b*sin(angle);dest[target+j+p.d/2]=a*sin(angle)+b*cos(angle);
 } else for(uint j=lane;j<p.d;j+=32)dest[target+j]=packed[source+j]*f;
}
kernel void attention(device const float *q [[buffer(0)]], device const float *k [[buffer(1)]],
 device const float *v [[buffer(2)]], device float *out [[buffer(3)]], device const int *starts [[buffer(4)]],
 device const int *lens [[buffer(5)]], constant P &p [[buffer(6)]], uint i [[thread_position_in_grid]],
 uint lane [[thread_index_in_simdgroup]]) {
 uint r=i/32,t=r/4,h=r%4; if(t>=p.n)return;
 uint kh=h/(4/(512/p.d)),start=starts[t],len=lens[t];float qq[16],acc[16];
 for(uint c=0;c<p.d/32;c++){qq[c]=q[t*4*p.d+h*p.d+lane+c*32];acc[c]=0;}
 float peak=-1e30f,denom=0;int lo=p.full?0:max(0,int(t-start)-512),hi=p.full?len:min(int(len),int(t-start)+513);
 for(int j=lo;j<hi;j++){
  float score=0;for(uint c=0;c<p.d/32;c++)score+=qq[c]*k[(start+j)*512+kh*p.d+lane+c*32];
  score=simd_sum(score);float np=max(peak,score),correction=exp(peak-np),weight=exp(score-np);
  denom=denom*correction+weight;
  for(uint c=0;c<p.d/32;c++)acc[c]=acc[c]*correction+weight*v[(start+j)*512+kh*p.d+lane+c*32];peak=np;
 }
 for(uint c=0;c<p.d/32;c++)out[t*4*p.d+h*p.d+lane+c*32]=acc[c]/denom;
}
kernel void activation(device const float *x [[buffer(0)]], device const float *ple [[buffer(1)]],
 device float *y [[buffer(2)]], constant P &p [[buffer(3)]],uint i [[thread_position_in_grid]]) {
 if(i>=p.n*p.d)return;
 if(p.a==0){uint at=i/2048*4096+i%2048;y[i]=gelu(x[at])*x[at+2048];}
 else y[i]=gelu(x[i])*ple[(i/512*24+p.layer)*512+i%512];
}
kernel void pool(device const float *x [[buffer(0)]],device float *y [[buffer(1)]],
 device const int *offsets [[buffer(2)]],device const int *lens [[buffer(3)]],constant P &p [[buffer(4)]],
 uint i [[thread_position_in_grid]]) {
 if(i>=p.count*512)return;uint seq=i/512,j=i%512;float s=0;
 for(int t=0;t<lens[seq];t++)s+=x[(offsets[seq]+t)*512+j];y[i]=s/lens[seq];
}
kernel void l2(device float *x [[buffer(0)]],constant P &p [[buffer(1)]],uint i [[thread_position_in_grid]],
 uint lane [[thread_index_in_simdgroup]]) {
 uint r=i/32;if(r>=p.count)return;float s=0;
 for(uint j=lane;j<768;j+=32){float a=x[r*768+j];s+=a*a;}float f=rsqrt(simd_sum(s));
 for(uint j=lane;j<768;j+=32)x[r*768+j]*=f;
}
