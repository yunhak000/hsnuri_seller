This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# hansom-order-tool

## 화면 업데이트

배포 버전을 접속 시, 화면 복귀 시, 1분 간격으로 확인합니다. 업로드와 파일 생성 직전에도 버전을 확인하고, 새 버전이 있으면 기존 데이터를 변경하거나 파일을 생성하지 않고 업데이트를 안내합니다.

‘지금 업데이트’를 누르면 현재 작업 저장을 기다린 뒤 최신 화면을 불러옵니다. 배포별 정적 파일 주소와 캐시하지 않는 버전 API를 사용하며, 브라우저 전체 캐시나 사이트 데이터를 삭제하지 않습니다.

엑셀 비밀번호는 평소에는 메모리에만 보관합니다. 업데이트 버튼으로 전환할 때만 해당 탭의 `sessionStorage`에 최대 60초 유효한 일회성 전달 값을 저장하고, 다음 화면에서 읽는 즉시 삭제합니다. 일반 새로고침이나 탭 종료 시에는 기억하지 않으며, 임시 저장이 차단된 환경에서는 다시 입력해야 합니다.

이 기능이 포함되기 전에 열어둔 탭은 한 번 새로 열어야 자동 감지가 시작됩니다. 자동 테스트는 `npm test`로 실행합니다.
