import JSZip from "jszip";
import { saveAs } from "file-saver";

export const arrayBufferToBlob = (ab: ArrayBuffer) =>
  new Blob([ab], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

export const downloadXlsx = (ab: ArrayBuffer, filename: string) => {
  saveAs(arrayBufferToBlob(ab), filename);
};

export const downloadZip = async (
  zipName: string,
  files: { filename: string; data: ArrayBuffer }[],
) => {
  const zip = new JSZip();
  // ZIP의 DOS 시간에는 시간대 정보가 없고 JSZip은 UTC 필드로 기록합니다.
  // 압축을 풀었을 때 한국 시각으로 표시되도록 KST의 벽시계 시간을 전달합니다.
  const zipDateKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  files.forEach((f) => {
    zip.file(f.filename, f.data, { date: zipDateKST });
  });
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, zipName);
};
