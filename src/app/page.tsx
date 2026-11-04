"use client";

import { useEffect, useMemo, useState } from "react";
import { UploadBox } from "@/components/UploadBox";
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
import { TAppState, TChannel, TParsedFile, TStandardRow } from "@/lib/types";

const todayKST = () => {
  // 브라우저 로컬이 KST일 가능성이 높지만, 포맷은 단순하게 local date 사용
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const id = () => Math.random().toString(36).slice(2);
type TAppError = Error & { code?: string };

const makeAppError = (message: string, code?: string): TAppError => {
  const err = new Error(message) as TAppError;
  err.code = code;
  return err;
};

const getErrorCode = (e: unknown): string | undefined => {
  if (typeof e !== "object" || e === null || !("code" in e)) return undefined;
  const { code } = e as { code?: unknown };
  return typeof code === "string" ? code : undefined;
};

const getErrorMessage = (e: unknown, fallback = "알 수 없는 에러") => {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
};

export default function HomePage() {
  const [state, setState] = useState<TAppState>({
    parsedFiles: [],
    standardRows: [],
  });

  const [errors, setErrors] = useState<string[]>([]);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionPassword, setSessionPassword] = useState("");

  useEffect(() => {
    setErrorModalOpen(errors.length > 0);
  }, [errors]);

  useEffect(() => {
    if (!errorModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setErrorModalOpen(false);
        setErrors([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [errorModalOpen]);

  const decryptFileOnServer = async (file: File, password: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("password", password);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch("/api/decrypt-excel", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        let payload: { code?: string; message?: string } | null = null;
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }

        throw makeAppError(
          payload?.message ?? "파일을 열지 못했어요. 다시 시도해주세요.",
          payload?.code ?? "DECRYPT_FAILED",
        );
      }

      return await res.arrayBuffer();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw makeAppError(
          "복호화가 지연되고 있어요. 잠시 후 다시 시도해주세요.",
          "DECRYPT_TIMEOUT",
        );
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const ensureReadableArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
    const originalAb = await file.arrayBuffer();

    // 1) 비용 없는 기본 경로: 클라이언트 파싱
    try {
      await readWorkbook(originalAb);
      return originalAb;
    } catch {
      // 2) 실패하면 암호화 파일 가능성으로 복호화 경로 진입
    }

    let wrongCount = 0;
    let lastError = "";
    const maxWrongCount = 5;

    const tryWithPassword = async (password: string) => {
      const decryptedAb = await decryptFileOnServer(file, password);
      await readWorkbook(decryptedAb); // 복호화 결과 검증
      setSessionPassword(password);
      setErrors([]);
      return decryptedAb;
    };

    // 세션 비밀번호가 있으면 우선 자동 시도(UX 단축)
    if (sessionPassword.trim()) {
      try {
        return await tryWithPassword(sessionPassword.trim());
      } catch (e: unknown) {
        if (getErrorCode(e) === "INVALID_PASSWORD") {
          wrongCount += 1;
          lastError = "마지막으로 입력한 비밀번호가 맞지 않았어요.";
          const remain = maxWrongCount - wrongCount;
          setErrors([
            `비밀번호가 올바르지 않아요. 남은 시도 횟수: ${remain}회`,
          ]);
        } else {
          throw new Error(
            getErrorMessage(
              e,
              "암호화된 파일을 처리하지 못했어요. 잠시 후 다시 시도해주세요.",
            ),
          );
        }
      }
    }

    while (wrongCount < maxWrongCount) {
      const remain = maxWrongCount - wrongCount;
      const promptText = [
        `${file.name} 파일은 암호화되어 있어요.`,
        "엑셀 비밀번호를 입력해주세요.",
        remain < maxWrongCount
          ? `비밀번호가 일치하지 않았어요. 남은 시도: ${remain}회`
          : "비밀번호는 같은 세션에서 자동 재사용됩니다.",
        lastError ? `안내: ${lastError}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const input = window.prompt(promptText, sessionPassword || "");
      if (input === null) {
        throw new Error("암호화된 파일 업로드를 취소했어요.");
      }

      const password = input.trim();
      if (!password) {
        lastError = "비밀번호를 비워둘 수 없어요.";
        continue;
      }

      try {
        return await tryWithPassword(password);
      } catch (e: unknown) {
        if (getErrorCode(e) === "INVALID_PASSWORD") {
          wrongCount += 1;
          lastError = "비밀번호가 올바르지 않아요.";
          const remain = maxWrongCount - wrongCount;
          setErrors([
            `비밀번호가 올바르지 않아요. 남은 시도 횟수: ${remain}회`,
          ]);
          continue;
        }
        throw new Error(
          getErrorMessage(
            e,
            "암호화된 파일을 처리하지 못했어요. 잠시 후 다시 시도해주세요.",
          ),
        );
      }
    }

    throw new Error(
      "비밀번호 입력 시도를 5회 초과했어요. 다시 업로드해 시도해주세요.",
    );
  };

  // 새로고침 복구
  useEffect(() => {
    (async () => {
      const saved = await loadState();
      if (saved) setState(saved);
    })();
  }, []);

  // 저장
  useEffect(() => {
    saveState(state).catch(() => {});
  }, [state]);

  const channelCount = useMemo(() => {
    const c: Record<TChannel, number> = {
      NAVER: 0,
      TOSS: 0,
      COUPANG: 0,
      MANDARINSPOON: 0,
    };
    state.parsedFiles.forEach((f) => (c[f.channel] += 1));
    return c;
  }, [state.parsedFiles]);

  const onUploadOriginals = async (files: File[]) => {
    setErrors([]);
    setBusy("원본 엑셀 분석 중…");

    try {
      const parsed: TParsedFile[] = [];
      const standards: TStandardRow[] = [];

      for (const file of files) {
        const ab = await ensureReadableArrayBuffer(file);
        const wb = await readWorkbook(ab);
        const ws = getFirstSheet(wb);

        const { headers, headerRowIndex } = readHeadersAuto(ws);
        const channel = detectChannelByHeaders(headers);

        if (!channel) {
          setErrors((p) => [
            ...p,
            `${file.name}: 채널 판별 실패(헤더를 확인해주세요)`,
          ]);
          continue;
        }

        const rows = readRowsAsObjects(ws, headers, headerRowIndex);
        rows.forEach((r) => {
          const s = normalizeRow(channel, r);
          // 주문번호 없으면 제외
          if (s.orderKey) standards.push(s);
        });

        parsed.push({
          id: id(),
          name: file.name,
          channel,
          headers,
          rowCount: rows.length,
          sourceArrayBuffer: ab,
        });
      }

      setState((prev) => {
        const mergedRows = [...prev.standardRows, ...standards];
        const dedupedRows = dedupeByOrderKey(mergedRows);

        return {
          ...prev,
          parsedFiles: [...prev.parsedFiles, ...parsed],
          standardRows: dedupedRows,
        };
      });
    } catch (e: unknown) {
      setErrors((p) => [...p, getErrorMessage(e)]);
    } finally {
      setBusy(null);
    }
  };

  const onBuildIntegration = async () => {
    setErrors([]);
    setBusy("통합발주서 생성 중…");

    try {
      if (!state.standardRows.length) {
        setErrors(["통합할 주문이 없어요. 원본 엑셀을 먼저 업로드해주세요."]);
        return;
      }

      const res = await fetch(
        "/templates/integration-order-template-clean.xlsx",
      );
      if (!res.ok)
        throw new Error(
          "통합발주서 템플릿을 불러오지 못했어요. public/templates 경로를 확인해주세요.",
        );
      const templateAB = await res.arrayBuffer();
      const integrationAB = await buildIntegrationWorkbook(
        templateAB,
        state.standardRows,
      );

      setState((prev) => ({ ...prev, integrationXlsx: integrationAB }));
      downloadXlsx(integrationAB, `통합발주서_${todayKST()}.xlsx`);
    } catch (e: unknown) {
      setErrors((p) => [...p, getErrorMessage(e)]);
    } finally {
      setBusy(null);
    }
  };

  const onUploadHansomResult = async (files: File[]) => {
    setErrors([]);
    setBusy("결과 파일 분석 중…");

    try {
      const file = files[0];
      if (!file) return;

      const ab = await ensureReadableArrayBuffer(file);
      const map = await buildHansomMap(ab);

      // 리포트
      const originKeys = new Set(state.standardRows.map((r) => r.orderKey));
      const hansomKeys = new Set([...map.keys()]);

      const missingInHansom: string[] = [];
      originKeys.forEach((k) => {
        if (!hansomKeys.has(k)) missingInHansom.push(k);
      });

      const missingInOrigin: string[] = [];
      hansomKeys.forEach((k) => {
        if (!originKeys.has(k)) missingInOrigin.push(k);
      });

      let matched = 0;
      originKeys.forEach((k) => {
        if (hansomKeys.has(k)) matched += 1;
      });

      const hansomMapObj: Record<string, string> = {};
      map.forEach((v, k) => (hansomMapObj[k] = v));

      setState((prev) => ({
        ...prev,
        hansomResultXlsx: ab,
        hansomMap: hansomMapObj,
        matchReport: {
          totalOriginalRows: prev.standardRows.length,
          totalHansomRows: map.size,
          matched,
          missingInHansom,
          missingInOrigin,
        },
      }));
    } catch (e: unknown) {
      setErrors((p) => [...p, getErrorMessage(e)]);
    } finally {
      setBusy(null);
    }
  };

  const onDownloadZip = async () => {
    setErrors([]);
    setBusy("ZIP 생성 중…");

    try {
      if (!state.hansomMap) {
        setErrors(["결과 엑셀을 먼저 업로드해주세요."]);
        return;
      }

      const map = new Map<string, string>(Object.entries(state.hansomMap));

      // 채널별 원본 파일들만 골라서, “원본 파일마다 운송장 채운 엑셀”을 만들고
      // 같은 채널끼리는 “하나로 합칠지” 선택지가 있지만, 우선은:
      // - 채널별로 첫 파일 기준으로 결과 만들기 + (여러 파일이면 각각 결과도 만들 수 있음)
      // 너 요구는 “채널별 1개씩”이므로: 채널별로 원본들을 합쳐서 “한 파일”로 만들지는
      // 구현 복잡도가 올라감. 대신 가장 안전한 방식은:
      // - 채널별로 업로드된 원본 파일들을 각각 운송장 채워서 ZIP에 모두 넣는 것.
      // 그런데 너는 4개 파일(채널별 1개) 원했지?
      // -> 여기서는 “채널별 원본이 여러 개면, 채널별로 첫 번째 파일을 베이스로 생성”으로 해두고,
      //    곧바로 다음 단계에서 "채널별 병합 출력"로 개선 가능.
      // (실사용에서는 네이버가 2~3개면 출력도 2~3개가 더 안전하긴 함.)

      const pickFirst = (ch: TChannel) =>
        state.parsedFiles.find((f) => f.channel === ch);

      const outputs: { filename: string; data: ArrayBuffer }[] = [];

      const naver = pickFirst("NAVER");
      if (naver) {
        const out = await fillTrackingToOriginal(
          "NAVER",
          naver.sourceArrayBuffer,
          map,
        );
        outputs.push({ filename: `네이버_${todayKST()}.xlsx`, data: out });
      }

      const toss = pickFirst("TOSS");
      if (toss) {
        const out = await fillTrackingToOriginal(
          "TOSS",
          toss.sourceArrayBuffer,
          map,
        );
        outputs.push({ filename: `토스_${todayKST()}.xlsx`, data: out });
      }

      const coupang = pickFirst("COUPANG");
      if (coupang) {
        const out = await fillTrackingToOriginal(
          "COUPANG",
          coupang.sourceArrayBuffer,
          map,
        );
        outputs.push({ filename: `쿠팡_${todayKST()}.xlsx`, data: out });
      }

      const gyul = pickFirst("MANDARINSPOON");
      if (gyul) {
        const out = await fillTrackingToOriginal(
          "MANDARINSPOON",
          gyul.sourceArrayBuffer,
          map,
        );
        outputs.push({ filename: `기타_${todayKST()}.xlsx`, data: out });
      }

      if (!outputs.length) {
        setErrors([
          "다운로드할 결과가 없어요. 원본 파일/결과 파일을 확인해주세요.",
        ]);
        return;
      }

      await downloadZip(`결과_${todayKST()}.zip`, outputs);
    } catch (e: unknown) {
      setErrors((p) => [...p, getErrorMessage(e)]);
    } finally {
      setBusy(null);
    }
  };

  const onReset = async () => {
    const ok = window.confirm(
      "정말 전체 초기화할까요? (업로드/결과/저장된 상태가 모두 삭제됩니다)",
    );
    if (!ok) return;

    await clearState();
    setState({ parsedFiles: [], standardRows: [] });
    setErrors([]);
  };

  const dedupeByOrderKey = <T extends { channel: string; orderKey: string }>(
    rows: T[],
  ) => {
    const map = new Map<string, T>();

    for (const r of rows) {
      const key = `${r.channel}:${r.orderKey}`;
      if (!map.has(key)) {
        map.set(key, r); // 첫 번째만 유지
      }
    }

    return Array.from(map.values());
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-200">
          통합발주 & 운송장 역변환 도구
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          네이버/토스/쿠팡/기타 주문 엑셀을 한 번에 업로드 → 통합발주서 생성 →
          결과 업로드 → ZIP 다운로드
        </p>
      </header>

      <div className="grid gap-6">
        {/* A단계 */}
        <section className="rounded-2xl border border-neutral-200 bg-neutral-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-neutral-200">
                A단계 · 원본 업로드 → 통합발주서 생성
              </div>
              <div className="mt-1 text-sm text-neutral-600">
                여러 파일을 한 번에 올리면 자동 판별해 기타 양식으로 합칩니다.
              </div>
            </div>

            <button
              onClick={onReset}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-100"
            >
              전체 리셋
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <UploadBox
              title="원본 주문 엑셀 업로드 (한 번에)"
              description="네이버/토스/쿠팡/기타 파일을 여러 개 선택해서 올려도 됩니다."
              disabled={!!busy}
              onFiles={onUploadOriginals}
            />

            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="text-base font-semibold">요약</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-neutral-50 p-3">
                  <div className="text-neutral-500">네이버 파일</div>
                  <div className="mt-1 text-lg font-bold">
                    {channelCount.NAVER}
                  </div>
                </div>
                <div className="rounded-xl bg-neutral-50 p-3">
                  <div className="text-neutral-500">토스 파일</div>
                  <div className="mt-1 text-lg font-bold">
                    {channelCount.TOSS}
                  </div>
                </div>
                <div className="rounded-xl bg-neutral-50 p-3">
                  <div className="text-neutral-500">쿠팡 파일</div>
                  <div className="mt-1 text-lg font-bold">
                    {channelCount.COUPANG}
                  </div>
                </div>
                <div className="rounded-xl bg-neutral-50 p-3">
                  <div className="text-neutral-500">기타 파일</div>
                  <div className="mt-1 text-lg font-bold">
                    {channelCount.MANDARINSPOON}
                  </div>
                </div>
                <div className="col-span-2 rounded-xl bg-neutral-50 p-3">
                  <div className="text-neutral-500">통합 대상 주문 행</div>
                  <div className="mt-1 text-lg font-bold">
                    {state.standardRows.length}
                  </div>
                </div>
              </div>

              <button
                onClick={onBuildIntegration}
                disabled={!state.standardRows.length || !!busy}
                className="mt-4 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                통합발주서 생성 & 다운로드
              </button>

              <div className="mt-2 text-xs text-neutral-500">
                파일명:{" "}
                <span className="font-medium">
                  통합발주서_{todayKST()}.xlsx
                </span>
              </div>
            </div>
          </div>

          {/* 미리보기 */}
          {/* <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="text-base font-semibold">미리보기 (상위 20행)</div>
            {!previewRows.length ? (
              <div className="mt-3 text-sm text-neutral-500">
                업로드하면 미리보기가 표시됩니다.
              </div>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="min-w-[900px] table-auto border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-50 text-left">
                      {[
                        "채널",
                        "주문번호",
                        "상품명",
                        "수량",
                        "수취인",
                        "연락처",
                        "주소",
                      ].map((h) => (
                        <th
                          key={h}
                          className="border-b border-neutral-200 px-3 py-2 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50">
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.channel}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.orderKey}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.productName}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.quantity}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.receiverName}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.receiverPhone}
                        </td>
                        <td className="border-b border-neutral-100 px-3 py-2">
                          {r.address}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div> */}
        </section>

        {/* 스타일 맞춤 */}
        {/* B단계 */}
        <section className="rounded-2xl border border-neutral-200 bg-neutral-900 p-5 text-neutral-200">
          <div className="text-lg font-semibold">
            B단계 · 결과 업로드 → ZIP 다운로드
          </div>
          <div className="mt-1 text-sm text-neutral-600">
            결과 엑셀에서 고객주문번호(또는 거래처주문번호/상품주문번호)로 매칭해
            운송장번호를 채웁니다.
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <UploadBox
              title="결과 엑셀 업로드"
              description="운송장번호 + 고객주문번호(또는 거래처주문번호/상품주문번호)가 포함된 파일"
              multiple={false}
              disabled={!!busy}
              onFiles={onUploadHansomResult}
            />

            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="text-base font-semibold">매칭 리포트</div>

              {!state.matchReport ? (
                <div className="mt-3 text-sm text-neutral-500">
                  결과 파일을 업로드하면 리포트가 표시됩니다.
                </div>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-neutral-600">원본 행 수</span>
                    <span className="font-semibold">
                      {state.matchReport.totalOriginalRows}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">결과 행 수</span>
                    <span className="font-semibold">
                      {state.matchReport.totalHansomRows}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">
                      매칭 성공(고유 주문번호 기준)
                    </span>
                    <span className="font-semibold">
                      {state.matchReport.matched}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">
                      원본에 있는데 결과에 없음
                    </span>
                    <span className="font-semibold">
                      {state.matchReport.missingInHansom.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">
                      결과에 있는데 원본에 없음
                    </span>
                    <span className="font-semibold">
                      {state.matchReport.missingInOrigin.length}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={onDownloadZip}
                disabled={!state.hansomMap || !!busy}
                className="mt-4 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                ZIP 다운로드 (네이버/토스/쿠팡/기타)
              </button>

              <div className="mt-2 text-xs text-neutral-500">
                ZIP 파일명:{" "}
                <span className="font-medium">결과_{todayKST()}.zip</span>
              </div>
            </div>
          </div>
        </section>

        {/* 상태/에러 */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold">상태</div>
            {busy && (
              <div className="rounded-xl bg-neutral-900 px-3 py-1 text-xs font-semibold text-white">
                {busy}
              </div>
            )}
          </div>

          <div className="mt-4 text-xs text-neutral-500">
            * 원본 파일이 여러 개인 채널(예: 네이버 2~3개) 출력은 현재 “채널별
            첫 파일” 기준으로 생성되어 있어요. 다음 단계에서 “채널별 병합
            출력(1파일)” 또는 “원본 파일별 출력(여러 파일)” 중 원하는 방식으로
            확정해 개선하면 됩니다.
          </div>
        </section>
      </div>

      {errorModalOpen && errors.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => {
            setErrorModalOpen(false);
            setErrors([]);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-semibold text-red-700">
              오류가 발생했어요
            </div>
            <div className="mt-1 text-sm text-neutral-600">
              총 {errors.length}건의 오류를 확인해주세요.
            </div>
            <ul className="mt-4 max-h-72 list-disc space-y-2 overflow-auto pl-5 text-sm text-red-800">
              {errors.map((e, idx) => (
                <li key={`${idx}-${e}`}>{e}</li>
              ))}
            </ul>
            <button
              className="mt-5 w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white"
              onClick={() => {
                setErrorModalOpen(false);
                setErrors([]);
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
