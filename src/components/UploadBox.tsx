"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { AppIcon } from "./AppIcon";

type Props = {
  title: string;
  description?: string;
  accept?: Record<string, string[]>;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onError?: (message: string) => void;
};

export const UploadBox = ({
  title,
  description,
  accept = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
      ".xlsx",
    ],
  },
  multiple = true,
  disabled = false,
  onFiles,
  onError,
}: Props) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!acceptedFiles?.length) return;
      onFiles(acceptedFiles);
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple,
    disabled,
    onDropRejected: (rejections) => {
      const tooMany = rejections.some((file) =>
        file.errors.some((error) => error.code === "too-many-files"),
      );
      onError?.(
        tooMany
          ? "결과 파일은 한 번에 1개만 선택해주세요."
          : ".xlsx 형식의 엑셀 파일을 선택해주세요.",
      );
    },
  });

  return (
    <div className="surface h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
      </div>

      <div
        {...getRootProps({
          role: "button",
          "aria-label": title,
          "aria-disabled": disabled,
        })}
        className={[
          "mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-10 text-center outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 sm:min-h-72",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          isDragActive
            ? "border-primary bg-primary-soft"
            : "border-[#d1d6db] bg-[#fafbfc] hover:border-primary hover:bg-[#f4f9f6]",
        ].join(" ")}
      >
        <input {...getInputProps({ "aria-label": title })} />
        <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <AppIcon name="upload" width={28} height={28} />
        </span>
        <div className="text-base font-bold">
          {isDragActive ? "여기에 놓아주세요" : "파일을 여기에 놓아주세요"}
        </div>
        <p className="mt-2 text-sm text-muted">
          또는 클릭해서 {multiple ? "파일 선택" : "파일 1개 선택"}
        </p>
        <span className="mt-5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-muted ring-1 ring-line">
          .xlsx {multiple ? "· 여러 파일 선택 가능" : "· 결과 파일 1개"}
        </span>
      </div>
    </div>
  );
};
