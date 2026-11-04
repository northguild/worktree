"use client";

import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { useStore } from "@tanstack/react-store";
import type React from "react";
import { createContext, useContext } from "react";
import { Portal } from "../components/Portal";

// biome-ignore lint/suspicious/noExplicitAny: generic context holds any TanStack form instance
const FormContext = createContext<any | null>(null);

interface FormProviderProps {
  // biome-ignore lint/suspicious/noExplicitAny: accepts any TanStack form instance
  form: any;
  debug?: boolean;
  children: React.ReactNode;
}

export function FormProvider({ form, debug, children }: FormProviderProps) {
  return (
    <>
      <FormContext.Provider value={form}>{children}</FormContext.Provider>
      {debug && typeof window !== "undefined" && import.meta.env.DEV && (
        <Portal containerRef={{ current: document.body }}>
          <TanStackDevtools
            plugins={[formDevtoolsPlugin()]}
            config={{
              position: "top-left",
              panelLocation: "top",
            }}
          />
        </Portal>
      )}
    </>
  );
}

export function useFormContext() {
  const f = useContext(FormContext);
  if (!f) throw new Error("useFormContext must be used inside a FormProvider");
  return f;
}

// biome-ignore lint/suspicious/noExplicitAny: store state shape depends on form data shape unknown here
export function useFormStore<T>(selector: (s: any) => T) {
  const form = useFormContext();
  // biome-ignore lint/suspicious/noExplicitAny: selector cast required for generic store access
  return useStore(form.store, selector as any);
}

export function useFormSubmit() {
  const form = useFormContext();
  return form.handleSubmit;
}
