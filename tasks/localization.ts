import type { Task } from "./types";

// Human-reviewed presentation translations; benchmark IDs, source excerpts and reference values stay intact.
export const koTaskText: Record<string, string> = {
  "Blocksworld planning task": "Blocksworld 계획 과제",
  "TravelPlanner itinerary task": "TravelPlanner 여행 일정 과제",
  "PlanBench · move blocks to a goal state.":
    "PlanBench · 블록을 목표 상태로 옮기는 과제입니다.",
  "TravelPlanner · prepare a 3-day itinerary using supplied travel data.":
    "TravelPlanner · 제공된 여행 자료로 3일 일정을 작성하는 과제입니다.",
  "Write a sequence of actions that moves the red, blue, yellow, and orange blocks from the initial state to the goal state. You may chat with the AI while working on the task.":
    "빨강, 파랑, 노랑, 주황 블록을 초기 상태에서 목표 상태로 옮기는 행동 순서를 작성하세요. 과제를 수행하는 동안 AI와 대화할 수 있습니다.",
  "Read the action rules, initial state, and goal. You may chat with the AI freely while working on the action sequence. Submit your final plan yourself when you are finished.":
    "행동 규칙, 초기 상태, 목표 상태를 읽으세요. 행동 순서를 계획하는 동안 AI와 자유롭게 대화할 수 있습니다. 완료하면 최종 계획을 직접 제출하세요.",
  "Pick up a block": "블록 집기",
  "Unstack a block": "쌓인 블록 꺼내기",
  "Put down a block": "블록 내려놓기",
  "Stack a block": "블록 쌓기",
  "You can pick up a block only if your hand is empty, the block is on the table, and the block is clear.":
    "손이 비어 있고, 블록이 테이블 위에 있으며, 블록 위가 비어 있을 때만 그 블록을 집을 수 있습니다.",
  "You can unstack a block only if your hand is empty, the block is directly on top of another block, and the block being removed is clear.":
    "손이 비어 있고, 블록이 다른 블록 바로 위에 있으며, 꺼낼 블록 위가 비어 있을 때만 그 블록을 꺼낼 수 있습니다.",
  "You can put down only a block you are holding. Placing it on the table makes your hand empty.":
    "들고 있는 블록만 내려놓을 수 있습니다. 테이블 위에 내려놓으면 손이 비게 됩니다.",
  "You can stack a block only if you are holding it and the other block is clear. Your hand then becomes empty, and the block underneath is no longer clear.":
    "블록을 들고 있고, 아래에 놓일 블록 위가 비어 있을 때만 그 위에 쌓을 수 있습니다. 쌓은 뒤에는 손이 비게 되고, 아래 블록 위는 더 이상 비어 있지 않습니다.",
  "You can pick up or unstack only one block at a time.":
    "한 번에 하나의 블록만 집거나 꺼낼 수 있습니다.",
  "A block is clear if no other block is on top of it and it is not being held.":
    "다른 블록이 위에 없고 손으로 들고 있지 않은 블록은 위가 비어 있는 상태입니다.",
  "Picking up or unstacking a block makes you hold it. You can put down or stack only a block you are holding.":
    "블록을 집거나 꺼내면 그 블록을 들게 됩니다. 들고 있는 블록만 내려놓거나 쌓을 수 있습니다.",
  "The red block is on top of the blue block.":
    "빨강 블록은 파랑 블록 위에 있습니다.",
  "The yellow block is on top of the orange block.":
    "노랑 블록은 주황 블록 위에 있습니다.",
  "The blue block and the orange block are on the table.":
    "파랑 블록과 주황 블록은 테이블 위에 있습니다.",
  "The red block and the yellow block are clear.":
    "빨강 블록과 노랑 블록 위는 비어 있습니다.",
  "Your hand is empty.": "손은 비어 있습니다.",
  "The orange block must be on top of the red block.":
    "주황 블록이 빨강 블록 위에 있어야 합니다.",
  "Write and submit your final plan as an ordered sequence of actions. You may use natural language or the action names (pick-up, unstack, put-down, stack). AI responses are not submitted automatically.":
    "행동 순서를 적어 최종 계획으로 제출하세요. 자연어나 행동 이름(pick-up, unstack, put-down, stack)을 사용할 수 있습니다. AI 응답은 자동으로 제출되지 않습니다.",
  "Prepare a travel itinerary that meets the request below. You may chat with the AI while working on the task.":
    "아래 요청을 충족하는 여행 일정을 작성하세요. 과제를 수행하는 동안 AI와 대화할 수 있습니다.",
  "Read the travel request and the supplied travel data. You may chat with the AI freely while preparing a day-by-day itinerary. Submit your final itinerary yourself when you are finished.":
    "여행 요청과 제공된 여행 자료를 읽으세요. 날짜별 일정을 작성하는 동안 AI와 자유롭게 대화할 수 있습니다. 완료하면 최종 일정을 직접 제출하세요.",
  "Please create a travel plan for me where I'll be departing from Washington and heading to Myrtle Beach for a 3-day trip from March 13th to March 15th, 2022. Can you help me keep this journey within a budget of $1,400?":
    "2022년 3월 13일부터 15일까지 3일간 Washington에서 출발해 Myrtle Beach로 여행하는 일정을 작성해 주세요. 여행 예산은 1,400달러 이내로 맞춰 주세요.",
  Departure: "출발지",
  Destination: "목적지",
  Dates: "날짜",
  Duration: "기간",
  Travelers: "여행 인원",
  Budget: "예산",
  "3 days": "3일",
  "Use the supplied travel options for this task. The dates and prices are fixed benchmark data. All listed options are available to both you and the AI.":
    "제공된 여행 자료를 사용하세요. 날짜와 가격은 벤치마크의 고정된 자료입니다. 참가자와 AI에는 동일한 선택지가 제공됩니다. 고유명사와 자료의 값은 원문 그대로 표시합니다.",
  "Write and submit your final day-by-day itinerary, including transportation, meals, attractions, and accommodation as applicable. Use the supplied travel data and stay within the requested budget and dates. AI responses are not submitted automatically.":
    "교통편, 식사, 관광지, 숙박을 필요한 경우 포함하여 최종 날짜별 일정을 작성하고 제출하세요. 제공된 여행 자료를 사용하고 요청된 예산과 날짜를 지키세요. AI 응답은 자동으로 제출되지 않습니다.",
  "Attractions in Myrtle Beach": "Myrtle Beach 관광지",
  "Restaurants in Myrtle Beach": "Myrtle Beach 음식점",
  "Accommodations in Myrtle Beach": "Myrtle Beach 숙박 시설",
  "Flight from Washington to Myrtle Beach on 2022-03-13":
    "2022-03-13 Washington → Myrtle Beach 항공편",
  "Flight from Myrtle Beach to Washington on 2022-03-15":
    "2022-03-15 Myrtle Beach → Washington 항공편",
  "Self-driving from Washington to Myrtle Beach":
    "Washington → Myrtle Beach 자가운전",
  "Self-driving from Myrtle Beach to Washington":
    "Myrtle Beach → Washington 자가운전",
  "Taxi from Washington to Myrtle Beach": "Washington → Myrtle Beach 택시",
  "Taxi from Myrtle Beach to Washington": "Myrtle Beach → Washington 택시",
  Name: "이름",
  NAME: "이름",
  Latitude: "위도",
  Longitude: "경도",
  Address: "주소",
  Phone: "전화번호",
  Website: "웹사이트",
  City: "도시",
  city: "도시",
  "Average Cost": "평균 비용",
  Cuisines: "음식 종류",
  "Aggregate Rating": "종합 평점",
  price: "가격",
  "room type": "객실 유형",
  house_rules: "숙소 규칙",
  "minimum nights": "최소 숙박일",
  "maximum occupancy": "최대 인원",
  "review rate number": "평점",
  "Flight Number": "항공편 번호",
  Price: "가격",
  DepTime: "출발 시각",
  ArrTime: "도착 시각",
  ActualElapsedTime: "소요 시간",
  FlightDate: "운항일",
  OriginCityName: "출발 도시",
  DestCityName: "도착 도시",
  Distance: "거리",
};

export function localizeTask(task: Task, language: "en" | "ko"): Task {
  if (language === "en") return task;
  const t = (text: string) => koTaskText[text] ?? text;
  const common = {
    ...task,
    language: "ko",
    title: t(task.title),
    description: t(task.description),
    participant_instruction: t(task.participant_instruction),
    final_instruction: t(task.final_instruction),
    source: {
      ...task.source,
      changes: [
        ...task.source.changes,
        "Korean presentation translation v1: translated instructions and task statements; original source excerpts, action identifiers, block identities and all travel reference values are retained.",
      ],
    },
  };
  if (task.kind === "blocksworld")
    return {
      ...common,
      kind: "blocksworld",
      actions: task.actions.map((a) => ({
        ...a,
        label: t(a.label),
        rule: t(a.rule),
      })),
      rules: task.rules.map(t),
      initial_state: task.initial_state.map(t),
      goal_state: task.goal_state.map(t),
      initial_stacks: task.initial_stacks,
      original: task.original,
    };
  return {
    ...common,
    kind: "travelplanner",
    query: t(task.query),
    trip_details: task.trip_details.map((d) => ({
      label: t(d.label),
      value: t(d.value),
    })),
    reference_notice: t(task.reference_notice),
    reference_information: task.reference_information,
    original: task.original,
  };
}
