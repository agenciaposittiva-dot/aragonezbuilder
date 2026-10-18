"use client";

import { ErrorState } from "@/components/app/error-state";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} />;
}
