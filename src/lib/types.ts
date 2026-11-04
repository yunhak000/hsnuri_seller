export type TChannel = "NAVER" | "TOSS" | "COUPANG" | "MANDARINSPOON";
export type TStep = 1 | 2 | 3 | 4;

export type TParsedFile = {
  id: string;
  name: string;
  channel: TChannel;
  headers: string[];
  rowCount: number;
  /** 원본 파일을 그대로 저장(역변환 시 원본 양식 유지 목적) */
  sourceArrayBuffer: ArrayBuffer;
};

export type TStandardRow = {
  channel: TChannel;

  // 공통 키(각 채널 주문번호를 표준 키로 들고 있음)
  orderKey: string;

  // 통합발주서에 꽂을 필드들
  orderedAt?: string; // 주문일시 (표시용 문자열)
  productName: string; // 상품명
  quantity: number; // 수량
  receiverName: string; // 수취인명
  receiverPhone: string; // 수취인연락처1
  zipCode?: string; // 우편번호
  address: string; // 통합배송지
  message?: string; // 배송메세지

  buyerName: string; // 구매자명
  buyerPhone: string; // 구매자연락처

  // 통합발주서용 추가 필드(규칙)
  adminBuyerName: string; // 어드민용 구매자명
  adminBuyerPhone: string; // 어드민용 구매자연락처

  // 운송장(초기엔 비어있고 B단계에서 채움)
  trackingNumber?: string;
};

export type THansomResultMap = Map<string, string>; // orderKey -> trackingNumber

export type TAppState = {
  step?: TStep;
  resultFileName?: string;
  zipDownloaded?: boolean;
  // A단계
  parsedFiles: TParsedFile[];
  standardRows: TStandardRow[];
  integrationXlsx?: ArrayBuffer;

  // B단계
  hansomResultXlsx?: ArrayBuffer;
  hansomMap?: { [orderKey: string]: string };

  // 리포트
  matchReport?: {
    totalOriginalRows: number;
    totalHansomRows: number;
    matched: number;
    missingInHansom: string[]; // 원본에 있는데 결과에 없는 주문번호
    missingInOrigin: string[]; // 결과에 있는데 원본에 없는 주문번호
  };
};
