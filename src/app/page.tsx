"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AppIcon } from "@/components/AppIcon";
import { UploadBox } from "@/components/UploadBox";
import {
  PasswordDialog,
  type TPasswordRequest,
} from "@/components/PasswordDialog";
import { detectChannelByHeaders } from "@/lib/mappings/detect";
import { normalizeRow } from "@/lib/mappings/normalize";
import {
  readWorkbook,
  getFirstSheet,
  readRowsAsObjects,
  readHeadersAuto,
} from "@/lib/excel/read";
import { buildIntegrationWorkbook } from "@/lib/excel/integrate";
import { buildHansomMap } from "@/lib/excel/hansom";
import { fillTrackingToOriginal } from "@/lib/excel/fillTracking";
import { downloadZip, downloadXlsx } from "@/lib/excel/zip";
import { clearState, loadState, saveState } from "@/lib/storage/storage";
import { canVisitStep, getRestoredStep } from "@/lib/workflow";
import type {
  TAppState,
  TChannel,
  TParsedFile,
  TStandardRow,
  TStep,
} from "@/lib/types";

const CHANNELS: { id: TChannel; label: string }[] = [
  { id: "NAVER", label: "네이버" },
  { id: "TOSS", label: "토스" },
  { id: "COUPANG", label: "쿠팡" },
  { id: "MANDARINSPOON", label: "기타" },
];
const STEPS: { number: TStep; title: string; description: string }[] = [
  {
    number: 1,
    title: "원본 업로드",
    description: "판매처별 주문 파일을 한 번에 올려주세요.",
  },
  {
    number: 2,
    title: "통합발주서",
    description: "모든 주문을 하나의 발주서로 받아보세요.",
  },
  {
    number: 3,
    title: "결과 업로드",
    description: "운송장번호가 입력된 결과 파일을 올려주세요.",
  },
  {
    number: 4,
    title: "최종 다운로드",
    description: "매칭 결과를 확인하고 판매처별 파일을 받아보세요.",
  },
];
const INITIAL_STATE: TAppState = { parsedFiles: [], standardRows: [], step: 1 };
const todayKST = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
const appError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

export default function HomePage() {
  const [state, setState] = useState<TAppState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [passwordRequest, setPasswordRequest] =
    useState<TPasswordRequest | null>(null);
  const passwordResolver = useRef<((password: string | null) => void) | null>(
    null,
  );
  const sessionPassword = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const step = state.step ?? 1;
  const disabled = !hydrated || !!busy;
  const report = state.matchReport;

  useEffect(() => {
    let active = true;
    loadState()
      .then((saved) => {
        if (active && saved)
          setState({ ...saved, step: getRestoredStep(saved) });
      })
      .catch(() => {
        if (active)
          setErrors([
            "이전 작업을 복원하지 못했어요. 원본 파일을 다시 올려주세요.",
          ]);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState(state).catch(() => {
      const message =
        "작업을 브라우저에 저장하지 못했어요. 새로고침하면 현재 작업이 사라질 수 있어요.";
      setErrors((previous) =>
        previous.includes(message) ? previous : [...previous, message],
      );
    });
  }, [state, hydrated]);

  useEffect(() => {
    if (hydrated) heading.current?.focus({ preventScroll: true });
  }, [step, hydrated]);

  const channelCount = useMemo(() => {
    const counts: Record<TChannel, number> = {
      NAVER: 0,
      TOSS: 0,
      COUPANG: 0,
      MANDARINSPOON: 0,
    };
    state.parsedFiles.forEach((file) => counts[file.channel]++);
    return counts;
  }, [state.parsedFiles]);
  const totalQuantity = useMemo(
    () => state.standardRows.reduce((sum, row) => sum + row.quantity, 0),
    [state.standardRows],
  );
  const multipleOriginals = CHANNELS.some(
    (channel) => channelCount[channel.id] > 1,
  );

  const goToStep = (next: TStep) => {
    if (disabled || !canVisitStep(state, next)) return;
    setState((previous) => ({ ...previous, step: next }));
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const resolvePassword = (password: string | null) => {
    setPasswordRequest(null);
    passwordResolver.current?.(password);
    passwordResolver.current = null;
  };

  const decryptFile = async (file: File, password: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("password", password);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/decrypt-excel", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload: { message?: string; code?: string } = await response
          .json()
          .catch(() => ({}));
        throw appError(
          payload.message ?? "파일을 열지 못했어요. 다시 시도해주세요.",
          payload.code ?? "DECRYPT_FAILED",
        );
      }
      return await response.arrayBuffer();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw appError(
          "복호화가 지연되고 있어요. 잠시 후 다시 시도해주세요.",
          "DECRYPT_TIMEOUT",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const ensureReadable = async (file: File): Promise<ArrayBuffer> => {
    const original = await file.arrayBuffer();
    try {
      await readWorkbook(original);
      return original;
    } catch {
      /* 암호 파일은 서버 복호화를 시도합니다. */
    }
    let wrongCount = 0;
    let lastError = "";
    const tryPassword = async (password: string) => {
      const decrypted = await decryptFile(file, password);
      await readWorkbook(decrypted);
      sessionPassword.current = password;
      return decrypted;
    };
    if (sessionPassword.current) {
      try {
        return await tryPassword(sessionPassword.current);
      } catch (error) {
        if (errorCode(error) !== "INVALID_PASSWORD") throw error;
        wrongCount++;
        lastError = "이전에 입력한 비밀번호가 맞지 않아요.";
      }
    }
    while (wrongCount < 5) {
      const password = await new Promise<string | null>((resolve) => {
        passwordResolver.current = resolve;
        setPasswordRequest({
          filename: file.name,
          remaining: 5 - wrongCount,
          error: lastError,
        });
      });
      if (password === null) throw new Error("암호 파일 업로드를 취소했어요.");
      try {
        return await tryPassword(password);
      } catch (error) {
        if (errorCode(error) !== "INVALID_PASSWORD") throw error;
        wrongCount++;
        lastError = "비밀번호가 올바르지 않아요.";
      }
    }
    throw new Error(
      "비밀번호 입력 시도 5회를 모두 사용했어요. 다시 업로드해주세요.",
    );
  };

  const onUploadOriginals = async (files: File[]) => {
    if (disabled) return;
    setErrors([]);
    setBusy("원본 엑셀을 분석하고 있어요");
    const parsed: TParsedFile[] = [];
    const standards: TStandardRow[] = [];
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          const buffer = await ensureReadable(file);
          const sheet = getFirstSheet(await readWorkbook(buffer));
          const { headers, headerRowIndex } = readHeadersAuto(sheet);
          const channel = detectChannelByHeaders(headers);
          if (!channel)
            throw new Error(
              "판매처를 구분하지 못했어요. 주문 엑셀 양식을 확인해주세요.",
            );
          const rows = readRowsAsObjects(sheet, headers, headerRowIndex);
          const normalized = rows
            .map((row) => normalizeRow(channel, row))
            .filter((row) => row.orderKey);
          if (!normalized.length)
            throw new Error("주문번호가 있는 주문을 찾지 못했어요.");
          standards.push(...normalized);
          parsed.push({
            id: crypto.randomUUID(),
            name: file.name,
            channel,
            headers,
            rowCount: normalized.length,
            sourceArrayBuffer: buffer,
          });
        } catch (error) {
          failures.push(`${file.name}: ${errorMessage(error)}`);
        }
      }
      if (parsed.length) {
        setState((previous) => {
          const unique = new Map<string, TStandardRow>();
          [...previous.standardRows, ...standards].forEach((row) => {
            const key = `${row.channel}:${row.orderKey}`;
            if (!unique.has(key)) unique.set(key, row);
          });
          return {
            parsedFiles: [...previous.parsedFiles, ...parsed],
            standardRows: [...unique.values()],
            step: 1,
          };
        });
      }
      setErrors(failures);
    } finally {
      setBusy(null);
    }
  };

  const onBuildIntegration = async () => {
    if (disabled || !canVisitStep(state, 2)) return;
    setErrors([]);
    setBusy("통합발주서를 만들고 있어요");
    try {
      const response = await fetch(
        "/templates/integration-order-template-clean.xlsx",
      );
      if (!response.ok)
        throw new Error(
          "발주서 양식을 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
        );
      const output = await buildIntegrationWorkbook(
        await response.arrayBuffer(),
        state.standardRows,
      );
      downloadXlsx(output, `통합발주서_${todayKST()}.xlsx`);
      setState((previous) => ({ ...previous, integrationXlsx: output }));
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onUploadResult = async (files: File[]) => {
    if (disabled || !canVisitStep(state, 3)) return;
    const file = files[0];
    if (!file) return;
    setErrors([]);
    setBusy("운송장번호를 매칭하고 있어요");
    setState((previous) => ({
      ...previous,
      resultFileName: undefined,
      hansomResultXlsx: undefined,
      hansomMap: undefined,
      matchReport: undefined,
      zipDownloaded: false,
    }));
    try {
      const buffer = await ensureReadable(file);
      const result = await buildHansomMap(buffer);
      const map = new Map(
        [...result].filter(([, tracking]) => tracking.trim()),
      );
      if (!map.size)
        throw new Error(
          "입력된 운송장번호가 없어요. 운송장번호를 입력한 결과 파일을 올려주세요.",
        );
      const originKeys = new Set(state.standardRows.map((row) => row.orderKey));
      const matched = [...originKeys].filter((key) => map.has(key)).length;
      setState((previous) => ({
        ...previous,
        resultFileName: file.name,
        hansomResultXlsx: buffer,
        hansomMap: Object.fromEntries(map),
        zipDownloaded: false,
        matchReport: {
          totalOriginalRows: previous.standardRows.length,
          totalHansomRows: result.size,
          matched,
          missingInHansom: [...originKeys].filter((key) => !map.has(key)),
          missingInOrigin: [...map.keys()].filter(
            (key) => !originKeys.has(key),
          ),
        },
      }));
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onDownloadZip = async () => {
    if (disabled || !canVisitStep(state, 4)) return;
    setErrors([]);
    setBusy("판매처별 ZIP 파일을 만들고 있어요");
    try {
      const map = new Map(Object.entries(state.hansomMap ?? {}));
      const outputs: { filename: string; data: ArrayBuffer }[] = [];
      // 기존 판매처별 첫 원본 출력 방식을 유지합니다.
      for (const channel of CHANNELS) {
        const original = state.parsedFiles.find(
          (file) => file.channel === channel.id,
        );
        if (!original) continue;
        outputs.push({
          filename: `${channel.label}_${todayKST()}.xlsx`,
          data: await fillTrackingToOriginal(
            channel.id,
            original.sourceArrayBuffer,
            map,
          ),
        });
      }
      if (!outputs.length)
        throw new Error("다운로드할 원본이 없어요. 원본 파일을 확인해주세요.");
      await downloadZip(`결과_${todayKST()}.zip`, outputs);
      setState((previous) => ({ ...previous, zipDownloaded: true }));
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onReset = async () => {
    if (
      disabled ||
      !window.confirm(
        "업로드한 파일과 작업 내역을 모두 지우고 처음부터 시작할까요?",
      )
    )
      return;
    setBusy("작업을 초기화하고 있어요");
    try {
      await clearState();
      setState(INITIAL_STATE);
      sessionPassword.current = "";
      setErrors([]);
    } catch {
      setErrors(["초기화하지 못했어요. 다시 시도해주세요."]);
    } finally {
      setBusy(null);
    }
  };

  const stepComplete = (number: TStep) =>
    number === 1
      ? !!state.standardRows.length
      : number === 2
        ? !!state.integrationXlsx
        : number === 3
          ? canVisitStep(state, 4)
          : !!state.zipDownloaded;
  const nextStep = Math.min(step + 1, 4) as TStep;
  const fileList = (
    <div className="mt-5 max-h-64 space-y-3 overflow-y-auto">
      {state.parsedFiles.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-3 rounded-2xl bg-[#f7f8fa] p-4"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary">
            <AppIcon name="file" width={20} height={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-all text-sm font-semibold">{file.name}</p>
            <p className="mt-1 text-xs text-muted">
              {CHANNELS.find((channel) => channel.id === file.channel)?.label} ·
              주문 {file.rowCount.toLocaleString()}행
            </p>
          </div>
          <AppIcon
            name="check"
            className="shrink-0 text-primary"
            width={18}
            height={18}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-36">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative size-12 shrink-0 overflow-hidden mix-blend-multiply">
              <Image
                src="/logo.png"
                alt="한섬누리"
                width={300}
                height={105}
                priority
                className="absolute left-1/2 top-0 h-12 w-[137px] max-w-none -translate-x-1/2"
              />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">
                한섬누리 주문통합
              </p>
              <p className="mt-1 text-xs text-muted sm:text-sm">
                주문부터 운송장까지, 간편하게
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="btn-secondary min-h-11 shrink-0 px-3 sm:px-4"
            aria-label="모든 작업 초기화하고 처음부터 다시 시작"
            title="처음부터 다시"
          >
            <AppIcon name="reset" width={18} height={18} />
            <span className="hidden sm:inline">처음부터 다시</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-7 sm:px-8 sm:pt-10">
        <nav aria-label="주문 처리 단계" className="mb-9 sm:mb-11">
          <ol className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-2 sm:gap-2 sm:p-3">
            {STEPS.map((item) => (
              <li key={item.number} className="min-w-0">
                <button
                  type="button"
                  onClick={() => goToStep(item.number)}
                  disabled={disabled || !canVisitStep(state, item.number)}
                  aria-current={step === item.number ? "step" : undefined}
                  className={`flex h-full min-h-16 w-full flex-col items-center justify-center gap-2 rounded-xl px-1 py-3 text-xs font-semibold transition-colors sm:flex-row sm:gap-3 sm:px-4 sm:text-sm ${step === item.number ? "bg-primary-soft text-primary" : "text-muted enabled:hover:bg-[#f7f8fa] disabled:opacity-45"}`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${step === item.number ? "bg-primary text-white" : stepComplete(item.number) ? "bg-primary-soft text-primary" : "bg-[#f2f4f6]"}`}
                  >
                    {stepComplete(item.number) && step !== item.number ? (
                      <AppIcon name="check" width={14} height={14} />
                    ) : (
                      item.number
                    )}
                  </span>
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center gap-4 px-1">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-[#e5e8eb]"
              role="progressbar"
              aria-label="현재 작업 단계"
              aria-valuemin={1}
              aria-valuemax={4}
              aria-valuenow={step}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(step / 4) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-muted">{step} / 4</span>
          </div>
        </nav>

        <div className="mb-7">
          <p className="mb-2 text-xs font-bold tracking-widest text-primary">
            STEP 0{step}
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-[26px] font-bold tracking-tight outline-none sm:text-[32px]"
          >
            {STEPS[step - 1].title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
            {STEPS[step - 1].description}
          </p>
        </div>

        {errors.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-danger"
          >
            <AppIcon name="alert" className="shrink-0" width={20} height={20} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">확인이 필요해요</p>
              <ul className="mt-2 space-y-1.5">
                {errors.map((message, index) => (
                  <li key={index} className="break-words leading-relaxed">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setErrors([])}
              aria-label="오류 안내 닫기"
              className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-red-100"
            >
              <AppIcon name="close" width={18} height={18} />
            </button>
          </div>
        )}

        <div
          key={step}
          className="step-anim grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        >
          <section
            className="min-w-0 space-y-5"
            aria-label={STEPS[step - 1].title}
          >
            {step === 1 && (
              <>
                <UploadBox
                  title="판매처별 주문 파일"
                  description="네이버·토스·쿠팡·기타 엑셀을 올려주세요. 양식을 자동으로 구분합니다."
                  disabled={disabled}
                  onFiles={onUploadOriginals}
                  onError={(message) => setErrors([message])}
                />
                {state.parsedFiles.length > 0 && (
                  <div className="surface">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-bold">업로드한 파일</h2>
                      <span className="text-sm text-muted">
                        {state.parsedFiles.length}개
                      </span>
                    </div>
                    {fileList}
                    <p className="mt-4 text-xs leading-relaxed text-muted">
                      파일을 추가하면 통합발주서와 이전 매칭 결과를 다시
                      만들어야 해요.
                    </p>
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="surface">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                    <AppIcon name="file" width={28} height={28} />
                  </div>
                  <h2 className="mt-6 text-xl font-bold">
                    주문을 하나의 발주서로
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-muted">
                    판매처별 주문을 기타 양식에 맞춰 정리했어요.
                    <br className="hidden sm:block" />
                    품목, 수량, 배송지와 고객주문번호가 함께 들어갑니다.
                  </p>
                  <div className="my-6 flex items-center justify-between rounded-2xl bg-[#f7f8fa] p-5">
                    <span className="text-sm text-muted">통합할 주문</span>
                    <span className="text-xl font-bold">
                      {state.standardRows.length.toLocaleString()}
                      <span className="ml-1 text-sm font-medium text-muted">
                        건
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onBuildIntegration}
                    disabled={disabled}
                    className="btn-primary w-full sm:w-auto"
                  >
                    <AppIcon name="download" width={19} height={19} />
                    {state.integrationXlsx
                      ? "통합발주서 다시 받기"
                      : "통합발주서 다운로드"}
                  </button>
                  <p className="mt-3 break-all text-xs text-muted">
                    통합발주서_{todayKST()}.xlsx
                  </p>
                </div>
                <div className="rounded-2xl border border-primary/10 bg-primary-soft p-5">
                  <p className="text-sm font-semibold text-primary">
                    이미 발주서를 받으셨나요?
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#4e5968]">
                    다시 다운로드하지 않아도 결과 업로드로 바로 이동할 수
                    있어요.
                  </p>
                  <button
                    type="button"
                    onClick={() => goToStep(3)}
                    disabled={disabled}
                    className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary"
                  >
                    결과 업로드로 이동
                    <AppIcon name="next" width={17} height={17} />
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <UploadBox
                  title="운송장 결과 파일"
                  description="고객주문번호와 운송장번호가 포함된 엑셀을 선택해주세요. 기존 거래처주문번호·상품주문번호 양식도 사용할 수 있어요."
                  multiple={false}
                  disabled={disabled}
                  onFiles={onUploadResult}
                  onError={(message) => setErrors([message])}
                />
                {state.hansomMap && (
                  <div
                    role="status"
                    className="flex items-start gap-3 rounded-2xl bg-primary-soft p-5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                      <AppIcon name="check" width={18} height={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-primary">
                        결과 파일을 확인했어요
                      </p>
                      <p className="mt-1 break-all text-sm text-[#4e5968]">
                        {state.resultFileName ?? "저장된 결과 파일"}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        다음 단계에서 매칭 내역을 확인하고 파일을 받을 수
                        있어요.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {step === 4 && report && (
              <>
                <div className="surface">
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                      <AppIcon name="download" />
                    </span>
                    <div>
                      <h2 className="text-lg font-bold">
                        판매처별 파일이 준비됐어요
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        운송장번호를 원본 주문 양식에 반영합니다.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 divide-y divide-line">
                    {CHANNELS.filter((channel) => channelCount[channel.id]).map(
                      (channel) => (
                        <div
                          key={channel.id}
                          className="flex items-center gap-3 py-4"
                        >
                          <AppIcon
                            name="file"
                            width={20}
                            height={20}
                            className="shrink-0 text-primary"
                          />
                          <span className="min-w-0 flex-1 break-all text-sm font-medium">
                            {channel.label}_{todayKST()}.xlsx
                          </span>
                          <span className="rounded-lg bg-[#f2f4f6] px-2 py-1 text-xs text-muted">
                            XLSX
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f7f8fa] p-4 text-sm">
                    <span className="text-muted">다운로드 파일</span>
                    <span className="font-semibold">결과_{todayKST()}.zip</span>
                  </div>
                  {state.zipDownloaded && (
                    <p
                      role="status"
                      className="mt-5 flex items-center gap-2 text-sm font-semibold text-primary"
                    >
                      <AppIcon name="check" width={18} height={18} />
                      다운로드를 요청했어요. 브라우저의 다운로드 목록을
                      확인해주세요.
                    </p>
                  )}
                </div>
                {multipleOriginals && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">
                    <p className="font-bold">
                      같은 판매처의 파일이 여러 개 있어요
                    </p>
                    <p className="mt-2">
                      현재 ZIP에는 판매처별로 처음 올린 원본 파일만 포함됩니다.
                      나머지 원본의 주문도 별도로 처리해주세요.
                    </p>
                  </div>
                )}
                {(report.missingInHansom.length > 0 ||
                  report.missingInOrigin.length > 0) && (
                  <div className="surface">
                    <h2 className="text-base font-bold">매칭되지 않은 주문</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      운송장이 없는 주문은 기존 값이 유지됩니다. 아래 주문번호를
                      확인해주세요.
                    </p>
                    {[
                      {
                        label: "원본 주문에 운송장이 없음",
                        keys: report.missingInHansom,
                      },
                      {
                        label: "결과에만 있는 주문",
                        keys: report.missingInOrigin,
                      },
                    ]
                      .filter((group) => group.keys.length)
                      .map((group) => (
                        <details
                          key={group.label}
                          className="mt-4 rounded-xl border border-line p-4"
                        >
                          <summary className="text-sm font-semibold">
                            {group.label} · {group.keys.length.toLocaleString()}
                            건
                          </summary>
                          <ul className="mt-3 max-h-44 space-y-2 overflow-auto text-sm text-muted">
                            {group.keys.map((key) => (
                              <li key={key} className="break-all">
                                {key}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>

          <aside
            className="min-w-0 space-y-5 lg:sticky lg:top-6"
            aria-label="작업 요약"
          >
            <div className="surface">
              <h2 className="text-base font-bold">
                {step === 4 ? "매칭 결과" : "주문 요약"}
              </h2>
              <div className="mt-5">
                <p className="text-sm text-muted">
                  {step === 4 ? "운송장 매칭" : "통합 대상 주문"}
                </p>
                <p className="mt-2 text-4xl font-bold tracking-tight text-primary">
                  {(step === 4
                    ? (report?.matched ?? 0)
                    : state.standardRows.length
                  ).toLocaleString()}
                  <span className="ml-1.5 text-base font-medium text-muted">
                    건
                  </span>
                </p>
              </div>
              <div className="my-6 h-px bg-line" />
              {step === 4 && report ? (
                <dl className="space-y-4 text-sm">
                  {[
                    { label: "원본 주문", value: report.totalOriginalRows },
                    { label: "결과 주문번호", value: report.totalHansomRows },
                    {
                      label: "운송장 없는 주문",
                      value: report.missingInHansom.length,
                    },
                    {
                      label: "결과에만 있는 주문",
                      value: report.missingInOrigin.length,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex justify-between gap-3"
                    >
                      <dt className="text-muted">{item.label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {item.value.toLocaleString()}건
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    {CHANNELS.map((channel) => (
                      <div
                        key={channel.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-muted">{channel.label}</span>
                        <span className="font-semibold tabular-nums">
                          {channelCount[channel.id]}
                          <span className="ml-1 font-normal text-muted">
                            파일
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-center justify-between border-t border-line pt-5 text-sm">
                    <span className="text-muted">총 상품 수량</span>
                    <span className="font-semibold">
                      {totalQuantity.toLocaleString()}개
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="px-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#4e5968]">
                <AppIcon name="lock" width={16} height={16} />
                작업은 이 브라우저에 저장돼요
              </p>
              <p className="mt-2 text-xs leading-6 text-muted">
                새로고침해도 이어서 작업할 수 있어요. 공용 PC에서는 작업 후
                ‘처음부터 다시’를 눌러주세요. 암호 파일은 복호화를 위해 서버로
                전송됩니다.
              </p>
            </div>
          </aside>
        </div>

        <footer className="mt-12 border-t border-line pt-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-xs text-muted">
              한섬누리에서 운영하는 주문통합 서비스입니다.
            </p>
            <nav
              aria-label="한섬누리 관련 사이트"
              className="flex flex-wrap gap-2"
            >
              {[
                {
                  label: "한섬누리 홈페이지",
                  href: "https://hsnuri.com/default/",
                },
                {
                  label: "한섬누리 발주 사이트",
                  href: "https://hsnuri17.adminplus.co.kr/partner-app/#/login",
                },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${link.label} (새 탭)`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-[#4e5968] transition-colors hover:bg-primary-soft hover:text-primary"
                >
                  {link.label}
                  <AppIcon name="external" width={13} height={13} />
                </a>
              ))}
            </nav>
          </div>
        </footer>
      </main>

      <div className="action-bar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pt-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <p className="hidden text-sm text-muted sm:block">
            {step === 4
              ? `${report?.matched.toLocaleString() ?? 0}건의 운송장을 매칭했어요`
              : state.standardRows.length
                ? `${state.standardRows.length.toLocaleString()}건의 주문으로 작업 중이에요`
                : "원본 파일을 올리면 시작할 수 있어요"}
          </p>
          <div className="flex w-full gap-3 sm:w-auto">
            {step > 1 && (
              <button
                type="button"
                className="btn-secondary flex-1 sm:flex-none sm:min-w-28"
                disabled={disabled}
                onClick={() => goToStep((step - 1) as TStep)}
              >
                <AppIcon name="back" width={18} height={18} />
                이전
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                className="btn-primary flex-1 sm:min-w-44"
                disabled={disabled || !canVisitStep(state, nextStep)}
                aria-label={`${STEPS[nextStep - 1].title} 단계로 이동`}
                onClick={() => goToStep(nextStep)}
              >
                <span className="sm:hidden">다음</span>
                <span className="hidden sm:inline">
                  {step === 2 ? "결과 업로드로" : step === 3 ? "매칭 결과 확인" : "다음"}
                </span>
                <AppIcon name="next" width={18} height={18} />
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary flex-1 sm:min-w-44"
                disabled={disabled || !canVisitStep(state, 4)}
                onClick={onDownloadZip}
              >
                <AppIcon name="download" width={18} height={18} />
                <span className="sm:hidden">{state.zipDownloaded ? "다시 받기" : "ZIP 받기"}</span>
                <span className="hidden sm:inline">{state.zipDownloaded ? "ZIP 다시 받기" : "ZIP 다운로드"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {(!hydrated || busy) && !passwordRequest && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#191f28]/20 px-5 backdrop-blur-[2px]"
        >
          <div className="flex items-center gap-4 rounded-3xl bg-white px-7 py-6 shadow-xl">
            <span className="size-6 shrink-0 animate-spin rounded-full border-[3px] border-line border-t-primary" />
            <span className="text-sm font-semibold">
              {busy ?? "저장된 작업을 확인하고 있어요"}
            </span>
          </div>
        </div>
      )}
      {passwordRequest && (
        <PasswordDialog request={passwordRequest} onResolve={resolvePassword} />
      )}
    </div>
  );
}
