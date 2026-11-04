import type { TAppState, TStep } from "./types";

export const canVisitStep = (state: TAppState, step: TStep) => {
  if (step === 1) return true;
  if (!state.standardRows.length || !state.parsedFiles.length) return false;
  if (step === 4) {
    return (
      !!state.matchReport &&
      Object.values(state.hansomMap ?? {}).some((tracking) => tracking.trim())
    );
  }
  // 이전에 받은 발주서로 작업할 수 있도록 생성 여부와 무관하게 결과 업로드를 허용합니다.
  return true;
};

export const getRestoredStep = (state: TAppState): TStep => {
  const requested =
    state.step ?? (state.hansomMap ? 4 : state.integrationXlsx ? 2 : 1);
  if (![1, 2, 3, 4].includes(requested)) return 1;
  if (canVisitStep(state, requested)) return requested;
  return canVisitStep(state, 3) ? 3 : 1;
};
