"use client";

import { type ClipboardEvent, type KeyboardEvent, useCallback, useRef } from "react";

const OTP_LENGTH = 6;

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
};

/**
 * A 6-digit OTP input with individual digit boxes.
 *
 * Features:
 * - Auto-advance on digit input
 * - Backspace navigates to previous box
 * - Paste support (distributes digits across all boxes)
 * - Numeric keyboard on mobile
 */
export function OtpInput({ value, onChange, disabled = false, hasError = false }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(OTP_LENGTH, "").slice(0, OTP_LENGTH).split("");

  const focusInput = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, OTP_LENGTH - 1));
    inputRefs.current[clamped]?.focus();
  }, []);

  const updateDigit = useCallback(
    (index: number, digit: string) => {
      const next = [...digits];
      next[index] = digit;
      onChange(next.join(""));
    },
    [digits, onChange]
  );

  const handleInput = useCallback(
    (index: number, inputValue: string) => {
      const digit = inputValue.replace(/\D/g, "").slice(-1);

      if (!digit) return;

      updateDigit(index, digit);

      if (index < OTP_LENGTH - 1) {
        focusInput(index + 1);
      }
    },
    [updateDigit, focusInput]
  );

  const handleKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        event.preventDefault();

        if (digits[index]) {
          updateDigit(index, "");
        } else if (index > 0) {
          updateDigit(index - 1, "");
          focusInput(index - 1);
        }
      }

      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        focusInput(index - 1);
      }

      if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
        event.preventDefault();
        focusInput(index + 1);
      }
    },
    [digits, updateDigit, focusInput]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();

      const pasted = event.clipboardData
        .getData("text/plain")
        .replace(/\D/g, "")
        .slice(0, OTP_LENGTH);

      if (pasted.length === 0) return;

      onChange(pasted.padEnd(OTP_LENGTH, "").slice(0, OTP_LENGTH));

      const focusTarget = Math.min(pasted.length, OTP_LENGTH - 1);
      focusInput(focusTarget);
    },
    [onChange, focusInput]
  );

  return (
    <div
      className="otp-input-group"
      role="group"
      aria-label="Enter your 6-digit authenticator code"
    >
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          className={hasError ? "otp-input otp-input-error" : "otp-input"}
          type="text"
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
          value={digits[index] ?? ""}
          disabled={disabled}
          onInput={(event) =>
            handleInput(index, (event.target as HTMLInputElement).value)
          }
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
