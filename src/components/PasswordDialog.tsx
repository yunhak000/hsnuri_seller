"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcon } from "./AppIcon";

export type TPasswordRequest = {
  filename: string;
  remaining: number;
  error: string;
};

export function PasswordDialog({
  request,
  onResolve,
}: {
  request: TPasswordRequest;
  onResolve: (password: string | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="password-title"
      aria-describedby="password-description"
      className="app-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onResolve(null);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onResolve(password);
        }}
        className="p-6 sm:p-8"
      >
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <AppIcon name="lock" />
        </div>
        <h2 id="password-title" className="text-xl font-bold">
          엑셀 비밀번호를 입력해주세요
        </h2>
        <p
          id="password-description"
          className="mt-2 break-all text-sm leading-relaxed text-muted"
        >
          {request.filename}
          <br />
          일반 엑셀로 열 수 없는 파일입니다. 암호가 설정되어 있다면
          입력해주세요.
        </p>
        <label
          htmlFor="excel-password"
          className="mt-6 block text-sm font-semibold"
        >
          비밀번호
        </label>
        <input
          id="excel-password"
          type="password"
          autoComplete="off"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={request.error ? "password-error" : undefined}
          className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {request.error && (
          <p
            id="password-error"
            role="alert"
            className="mt-2 text-sm text-danger"
          >
            {request.error} 남은 시도: {request.remaining}회
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          파일과 비밀번호는 복호화를 위해 서버로 전송됩니다. 비밀번호는 이
          탭에서 재사용하며 업데이트할 때도 이어집니다. 일반 새로고침을 하거나
          탭을 닫으면 사라집니다.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onResolve(null)}
          >
            취소
          </button>
          <button type="submit" disabled={!password} className="btn-primary">
            파일 열기
          </button>
        </div>
      </form>
    </dialog>
  );
}
