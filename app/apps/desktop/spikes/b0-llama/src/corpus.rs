// SPDX-License-Identifier: Apache-2.0
//! 측정용 합성 말뭉치. 같은 주제를 한국어와 영어로 쓴 문단 12쌍과, 주제별 짧은 검색어다.
//! 실제 사용자 노트가 아니라 이 실험을 위해 새로 쓴 글이다.

pub struct Topic {
    pub ko: &'static str,
    pub en: &'static str,
    pub q_ko: &'static str,
    pub q_en: &'static str,
}

pub const TOPICS: [Topic; 12] = [
    Topic {
        ko: "이번 주 프로젝트 회의에서 출시 일정을 2주 뒤로 미루기로 했다. 결제 모듈 테스트가 끝나지 않았고, 디자인 검수에서 나온 수정 사항이 아직 절반밖에 반영되지 않았기 때문이다. 다음 회의 전까지 각자 남은 작업 목록을 정리해서 공유하기로 했다.",
        en: "In this week's project meeting we agreed to push the launch back by two weeks. Testing of the payment module is not finished, and only half of the fixes from the design review have been applied. Everyone will share a list of their remaining tasks before the next meeting.",
        q_ko: "출시 일정이 연기된 이유",
        q_en: "why the product launch was delayed",
    },
    Topic {
        ko: "김치찌개는 신 김치를 들기름에 먼저 볶아야 깊은 맛이 난다. 돼지고기 목살을 넣고 물이나 쌀뜨물을 부은 뒤 중불에서 20분쯤 끓인다. 마지막에 두부와 대파를 올리고 간은 새우젓으로 맞추면 좋다.",
        en: "Kimchi stew gets its depth of flavor when you fry sour kimchi in perilla oil first. Add pork shoulder, pour in water or rice water, and simmer over medium heat for about twenty minutes. Finish with tofu and scallions and season with salted shrimp.",
        q_ko: "김치찌개 끓이는 법",
        q_en: "how to cook kimchi stew",
    },
    Topic {
        ko: "러스트에서는 모든 값에 소유자가 하나만 있고, 소유자가 스코프를 벗어나면 값이 자동으로 해제된다. 값을 다른 변수로 옮기면 원래 변수는 더 이상 쓸 수 없다. 대신 참조를 빌려 주면 소유권을 넘기지 않고도 값을 읽을 수 있다.",
        en: "In Rust every value has exactly one owner, and the value is dropped automatically when the owner goes out of scope. Moving a value to another variable makes the original variable unusable. Borrowing a reference lets you read the value without transferring ownership.",
        q_ko: "러스트의 소유권과 빌림 규칙",
        q_en: "Rust ownership and borrowing rules",
    },
    Topic {
        ko: "여름에 제주도로 3박 4일 여행을 가려고 한다. 첫날은 협재 해변과 한림 칼국수 집을 가고, 둘째 날은 한라산 영실 코스를 오를 계획이다. 렌터카는 성수기라 한 달 전에 예약해야 하고, 숙소는 서귀포 쪽이 조용해서 좋다.",
        en: "I am planning a four-day summer trip to Jeju Island. The first day is for Hyeopjae beach and a noodle shop in Hallim, and the second day is the Yeongsil trail up Hallasan. Rental cars must be booked a month ahead in peak season, and the Seogwipo side is quieter for lodging.",
        q_ko: "제주도 여름 여행 계획",
        q_en: "summer vacation itinerary for Jeju",
    },
    Topic {
        ko: "투자 자산을 주식, 채권, 현금으로 나누어 두면 한 시장이 흔들려도 전체 손실이 줄어든다. 해마다 비중을 처음 목표로 되돌리는 리밸런싱을 하면 비싸진 자산을 팔고 싼 자산을 사게 된다. 수수료가 낮은 지수 펀드를 꾸준히 사 모으는 방법이 가장 단순하다.",
        en: "Splitting investments among stocks, bonds, and cash reduces the overall loss when one market falls. Rebalancing back to the original target weights each year means selling what has become expensive and buying what is cheap. Steadily accumulating low-fee index funds is the simplest approach.",
        q_ko: "자산 분산 투자와 리밸런싱",
        q_en: "portfolio diversification and rebalancing",
    },
    Topic {
        ko: "잠을 잘 자려면 매일 같은 시간에 자고 일어나는 것이 가장 중요하다. 잠들기 한 시간 전에는 스마트폰 화면을 끄고, 오후 두 시 이후에는 커피를 마시지 않는다. 침실은 어둡고 서늘하게 유지하는 편이 깊은 잠에 도움이 된다.",
        en: "The most important part of sleeping well is going to bed and waking up at the same time every day. Turn off phone screens an hour before bed and avoid coffee after two in the afternoon. Keeping the bedroom dark and cool helps you reach deep sleep.",
        q_ko: "숙면을 위한 수면 습관",
        q_en: "healthy sleep habits",
    },
    Topic {
        ko: "새 고객이 서비스를 처음 쓸 때 첫 10분이 가장 중요하다. 가입 직후에 해야 할 일을 세 단계로 줄여 보여 주고, 첫 성공을 빨리 경험하게 만들어야 한다. 온보딩 이메일은 기능 소개보다 고객이 이미 시작한 작업을 이어 가도록 돕는 내용이 반응이 좋았다.",
        en: "The first ten minutes matter most when a new customer starts using a service. Show the tasks to do right after signing up in just three steps so they reach a first success quickly. Onboarding emails that help customers continue what they already started performed better than feature introductions.",
        q_ko: "신규 고객 온보딩 개선",
        q_en: "improving new customer onboarding",
    },
    Topic {
        ko: "모델이 학습 데이터에서는 정확한데 새 데이터에서 성능이 급격히 떨어지면 과적합을 의심한다. 데이터를 더 모으거나, 정규화와 드롭아웃을 쓰거나, 모델 크기를 줄이면 완화할 수 있다. 검증 손실이 다시 오르기 시작하는 시점에 학습을 멈추는 조기 종료도 효과적이다.",
        en: "If a model is accurate on training data but performance drops sharply on new data, suspect overfitting. Collecting more data, applying regularization and dropout, or shrinking the model can mitigate it. Early stopping, which halts training when validation loss starts to rise again, is also effective.",
        q_ko: "머신러닝 과적합 해결 방법",
        q_en: "how to fix overfitting in machine learning",
    },
    Topic {
        ko: "처음 마라톤을 준비한다면 16주 계획이 적당하다. 주 3회 달리기 중 하루는 천천히 길게 달리고, 그 거리를 매주 조금씩 늘려 마지막 달에는 30킬로미터까지 간다. 대회 2주 전부터는 훈련량을 줄여 몸이 회복되게 해야 한다.",
        en: "A sixteen-week plan suits a first marathon. Of three runs a week, one is a slow long run whose distance grows a little each week until it reaches thirty kilometers in the final month. Starting two weeks before the race, cut your training volume so your body can recover.",
        q_ko: "마라톤 훈련 계획",
        q_en: "marathon training schedule for beginners",
    },
    Topic {
        ko: "데이터베이스 인덱스는 책의 색인처럼 특정 열의 값으로 행을 빨리 찾게 해 준다. 조회는 빨라지지만 쓰기마다 인덱스도 갱신해야 하므로 삽입과 수정은 느려진다. 자주 검색하고 값의 종류가 많은 열에만 인덱스를 만드는 것이 원칙이다.",
        en: "A database index works like a book's index, letting you find rows quickly by the value of a particular column. Reads get faster, but every write must also update the index, so inserts and updates slow down. The rule of thumb is to index only columns that are searched often and have many distinct values.",
        q_ko: "데이터베이스 인덱스의 장단점",
        q_en: "database index trade-offs",
    },
    Topic {
        ko: "책을 읽고 나서 인용문을 그대로 옮기기보다 내 말로 다시 써 두는 것이 기억에 오래 남는다. 각 메모에는 한 가지 생각만 담고, 관련 있는 다른 메모로 링크를 걸어 둔다. 이렇게 쌓인 메모들이 나중에 글을 쓸 때 재료가 된다.",
        en: "After reading a book, rewriting ideas in your own words sticks better than copying quotes verbatim. Keep one idea per note and link it to related notes. The notes that accumulate this way become raw material when you write later.",
        q_ko: "독서 노트 정리하는 방법",
        q_en: "how to take notes on books",
    },
    Topic {
        ko: "생두를 볶을 때는 열을 서서히 올리다가 첫 번째 크랙이 들리면 불을 줄여 단맛을 살린다. 크랙이 끝나고 바로 멈추면 산미가 밝은 라이트 로스트가 되고, 더 오래 볶으면 쓴맛이 강해진다. 볶은 뒤에는 이틀쯤 가스를 빼고 마시는 것이 좋다.",
        en: "When roasting green coffee, raise the heat gradually and lower it when you hear first crack to preserve sweetness. Stopping right after first crack gives a light roast with bright acidity, while roasting longer makes it more bitter. Let the beans degas for about two days before drinking.",
        q_ko: "커피 생두 로스팅 단계",
        q_en: "coffee roasting stages",
    },
];

/// 유사 쌍(같은 뜻), 무관 쌍(다른 주제)을 만들 때 쓰는 짧은 문장 쌍. (a, b, 유사 여부)
pub const PAIRS: [(&str, &str, bool); 8] = [
    ("오늘 저녁에 비가 올 것 같아서 우산을 챙겼다.", "I took an umbrella because it looks like rain this evening.", true),
    ("회의 자료를 금요일까지 공유해 주세요.", "Please send the meeting materials by Friday.", true),
    ("고양이가 소파 위에서 낮잠을 자고 있다.", "A cat is napping on the sofa.", true),
    ("서버 응답이 느려져서 캐시를 추가했다.", "We added a cache because the server responses were slow.", true),
    ("오늘 저녁에 비가 올 것 같아서 우산을 챙겼다.", "The quarterly revenue grew by twelve percent.", false),
    ("회의 자료를 금요일까지 공유해 주세요.", "고양이가 소파 위에서 낮잠을 자고 있다.", false),
    ("서버 응답이 느려져서 캐시를 추가했다.", "해변에서 아이들이 모래성을 쌓고 놀았다.", false),
    ("A cat is napping on the sofa.", "분기 매출이 12퍼센트 늘었다.", false),
];
