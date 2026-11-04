import type { SVGProps } from "react";

const paths = {
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4",
  download: "M12 4v12m-5-5 5 5 5-5M4 17v3h16v-3",
  file: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8M8 17h5",
  check: "m5 12 4 4L19 6",
  next: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  reset: "M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6",
  close: "m6 6 12 12M6 18 18 6",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5V11Zm7 4v2",
  alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3v.5",
  external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
} satisfies Record<string, string>;

export function AppIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
