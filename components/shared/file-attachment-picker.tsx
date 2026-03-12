"use client";

import { useId, useRef, type ChangeEvent } from "react";
import { Paperclip, X } from "lucide-react";

export function FileAttachmentPicker({
  files,
  accept,
  disabled = false,
  buttonLabel,
  hint,
  emptyLabel,
  removeLabel,
  onFilesSelected,
  onRemoveFile
}: {
  files: File[];
  accept?: string;
  disabled?: boolean;
  buttonLabel: string;
  hint?: string;
  emptyLabel?: string;
  removeLabel: string;
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.currentTarget.files ?? []);
    onFilesSelected(nextFiles);
  };

  const openPicker = () => {
    inputRef.current?.click();
  };

  return (
    <div className="attachment-picker">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple
        onChange={handleChange}
        disabled={disabled}
        hidden
      />
      <div className="attachment-picker-actions">
        <button type="button" className="button" onClick={openPicker} disabled={disabled}>
          {buttonLabel}
        </button>
        {hint ? <p className="form-hint attachment-picker-hint">{hint}</p> : null}
      </div>

      {files.length > 0 ? (
        <ul className="attachment-picker-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`} className="attachment-picker-item">
              <span className="attachment-picker-file-main">
                <Paperclip size={14} aria-hidden="true" />
                <span className="attachment-picker-file-name">{file.name}</span>
              </span>
              <button
                type="button"
                className="attachment-picker-remove"
                onClick={() => onRemoveFile(index)}
                disabled={disabled}
                aria-label={`${removeLabel}: ${file.name}`}
              >
                <X size={14} aria-hidden="true" />
                <span>{removeLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : emptyLabel ? (
        <p className="settings-card-description">{emptyLabel}</p>
      ) : null}
    </div>
  );
}
