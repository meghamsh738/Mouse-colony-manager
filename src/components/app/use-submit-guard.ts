"use client";

import { useEffect, useRef, type FormEvent } from "react";

export function useSubmitGuard(pending: boolean) {
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!pending) {
      isSubmittingRef.current = false;
    }
  }, [pending]);

  return (event: FormEvent<HTMLFormElement>) => {
    if (pending || isSubmittingRef.current) {
      event.preventDefault();
      return;
    }

    isSubmittingRef.current = true;
  };
}
