'use client';

import { useEffect, useRef } from 'react';

/** After a rejected submit, focus goes to the first field in error so the person hears what is wrong. */
export function useFocusFirstInvalid(errors: object) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return formRef;
}
