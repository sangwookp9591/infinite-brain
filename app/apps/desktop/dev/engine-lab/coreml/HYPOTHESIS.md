# E4 사전 가설 (측정 전)

- H1: 동일 BF16 tensor의 FP16 Core ML graph는 20개 공유 fixture에서 모두 Q8 reference cosine >=0.999를 유지한다. 하나라도 미달하면 반증된다.
- H2: Core ML CPU+ANE 또는 CPU+GPU / ALL 중 하나가 같은 세션 llama.cpp Q8 대비 82-token warm latency와 최적 batch 처리량 모두 우수하다. 둘 중 하나라도 개선되지 않으면 채택 가설은 반증된다.
- H3: 같은 모델/입력/FP16에서 compute unit 선택은 latency와 throughput을 바꾼다. compute plan상 장치 배치와 실제 runtime 관찰은 구분한다.

방법: 설정별 5개 독립 process, 30 warm single calls, 100문단 batch 1 warmup+3 trials. baseline과 각 설정을 A/B로 교차한다. GPU/ANE 실행·load 측정은 공유 mkdir lock 안에서만 수행한다. Sequence length 64/128/256/512와 batch 1/4를 enumerate하며 mask로 padding을 제외한다. 모든 원시 측정과 실패를 보존한다.

## 사후 실패 진단 가설 (추가 실행 전)

2026-10-20 17:15 KST: 열거 shape 모델의 CPU+ANE/ALL compute-plan 생성이 -5로 실패하고 CPU+GPU는 성공했다. H4: 열거된 여러 B/S shape가 ANE compiler 실패에 기여한다. 같은 가중치·수식을 고정 B=1/S=82로 변환해 plan/load가 성공하는지 비교한다. 고정 shape도 실패하면 이 원인 가설을 반증하며 ANE 하드웨어 자체의 성능 결론으로 확대하지 않는다. 이 static 모델은 원래 flexible/enumerated 주 모델을 대체하지 않는 진단용 대조군이다.
