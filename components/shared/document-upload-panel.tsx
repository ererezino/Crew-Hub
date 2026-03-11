"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useMemo,
  useRef,
  useState
} from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_FILE_BYTES,
  formatFileSize,
  getDocumentCategoryLabel,
  isAllowedDocumentUpload
} from "../../lib/documents";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentUploadResponse
} from "../../types/documents";
import { SlidePanel } from "./slide-panel";

const uploadFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().trim().max(2000, "Description is too long"),
  category: z.enum(DOCUMENT_CATEGORIES),
  expiryDate: z.union([z.literal(""), z.iso.date()]),
  countryCode: z.union([z.literal(""), z.string().trim().min(2).max(2)])
});

type UploadFormValues = z.infer<typeof uploadFormSchema>;
type UploadFormField = keyof UploadFormValues | "file";
type UploadFormErrors = Partial<Record<UploadFormField, string>>;
type UploadFormTouched = Record<UploadFormField, boolean>;

type DocumentUploadPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: (document: DocumentRecord) => void;
  currentUserId: string;
  allowedCategories: readonly DocumentCategory[];
  allowPolicyDocuments: boolean;
  existingDocument?: DocumentRecord | null;
};

const INITIAL_TOUCHED: UploadFormTouched = {
  title: false,
  description: false,
  category: false,
  expiryDate: false,
  countryCode: false,
  file: false
};

const ALL_TOUCHED: UploadFormTouched = {
  title: true,
  description: true,
  category: true,
  expiryDate: true,
  countryCode: true,
  file: true
};

const countryOptions = [
  { value: "", label: "No country" },
  { value: "NG", label: "Nigeria" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "ZA", label: "South Africa" },
  { value: "CA", label: "Canada" }
] as const;

const uploadAcceptValue = ALLOWED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function createInitialValues(existingDocument?: DocumentRecord | null): UploadFormValues {
  return {
    title: existingDocument?.title ?? "",
    description: existingDocument?.description ?? "",
    category: existingDocument?.category ?? "id_document",
    expiryDate: existingDocument?.expiryDate ?? "",
    countryCode: existingDocument?.countryCode ?? ""
  };
}

function hasAnyError(errors: UploadFormErrors): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

function validateFile(file: File | null): string | undefined {
  if (!file) {
    return "A file is required.";
  }

  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return "File exceeds the 25MB upload limit.";
  }

  if (!isAllowedDocumentUpload(file.name, file.type)) {
    return "Unsupported file type. Allowed: pdf, docx, doc, xlsx, xls, png, jpg.";
  }

  return undefined;
}

function getValidationErrors(
  values: UploadFormValues,
  touched: UploadFormTouched,
  allowedCategories: readonly DocumentCategory[],
  selectedFile: File | null
): UploadFormErrors {
  const parsed = uploadFormSchema.safeParse(values);
  const nextErrors: UploadFormErrors = {};

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    nextErrors.title = touched.title ? fieldErrors.title?.[0] : undefined;
    nextErrors.description = touched.description ? fieldErrors.description?.[0] : undefined;
    nextErrors.category = touched.category ? fieldErrors.category?.[0] : undefined;
    nextErrors.expiryDate = touched.expiryDate ? fieldErrors.expiryDate?.[0] : undefined;
    nextErrors.countryCode = touched.countryCode ? fieldErrors.countryCode?.[0] : undefined;
  }

  if (touched.category && !allowedCategories.includes(values.category)) {
    nextErrors.category = "Category is not allowed for this page.";
  }

  if (touched.file) {
    nextErrors.file = validateFile(selectedFile);
  }

  return nextErrors;
}

function uploadWithProgress(
  formData: FormData,
  onProgress: (progress: number) => void
): Promise<{ status: number; payload: DocumentUploadResponse | null }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/api/v1/documents/upload");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round((event.loaded / event.total) * 100);
      onProgress(progress);
    };

    request.onerror = () => {
      reject(new Error("Upload request failed."));
    };

    request.onload = () => {
      let payload: DocumentUploadResponse | null = null;

      try {
        payload = JSON.parse(request.responseText) as DocumentUploadResponse;
      } catch {
        payload = null;
      }

      resolve({
        status: request.status,
        payload
      });
    };

    request.send(formData);
  });
}

export function DocumentUploadPanel({
  isOpen,
  onClose,
  onUploaded,
  currentUserId,
  allowedCategories,
  allowPolicyDocuments,
  existingDocument = null
}: DocumentUploadPanelProps) {
  const t = useTranslations("documents");
  const [values, setValues] = useState<UploadFormValues>(createInitialValues(existingDocument));
  const [touched, setTouched] = useState<UploadFormTouched>(INITIAL_TOUCHED);
  const [errors, setErrors] = useState<UploadFormErrors>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mode = existingDocument ? "new_version" : "create";
  const isCategoryLocked = Boolean(existingDocument);
  const visibleCategoryOptions = useMemo(
    () => DOCUMENT_CATEGORIES.filter((category) => allowedCategories.includes(category)),
    [allowedCategories]
  );

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }

    onClose();
  };

  const handleFieldChange =
    (field: keyof UploadFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const nextValues = {
        ...values,
        [field]:
          field === "countryCode"
            ? event.currentTarget.value.toUpperCase()
            : event.currentTarget.value
      };

      setValues(nextValues);

      if (touched[field]) {
        setErrors(getValidationErrors(nextValues, touched, allowedCategories, selectedFile));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFieldBlur = (field: UploadFormField) => () => {
    const nextTouched = {
      ...touched,
      [field]: true
    };

    setTouched(nextTouched);
    setErrors(getValidationErrors(values, nextTouched, allowedCategories, selectedFile));
  };

  const handleFileSelection = (file: File | null) => {
    setSelectedFile(file);

    const nextTouched = {
      ...touched,
      file: true
    };

    setTouched(nextTouched);
    setErrors(getValidationErrors(values, nextTouched, allowedCategories, file));
    setSubmitError(null);
    setProgress(0);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    handleFileSelection(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    handleFileSelection(droppedFile);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setTouched(ALL_TOUCHED);
    const nextErrors = getValidationErrors(values, ALL_TOUCHED, allowedCategories, selectedFile);
    setErrors(nextErrors);
    setSubmitError(null);

    if (hasAnyError(nextErrors) || !selectedFile) {
      return;
    }

    setIsSubmitting(true);
    setProgress(0);

    const formData = new FormData();
    formData.set("title", values.title.trim());
    formData.set("description", values.description.trim());
    formData.set("category", values.category);
    formData.set("expiryDate", values.expiryDate);
    formData.set("countryCode", values.countryCode.toUpperCase());
    formData.set("file", selectedFile);

    if (mode === "new_version" && existingDocument) {
      formData.set("existingDocumentId", existingDocument.id);
    }

    if (values.category === "policy" && allowPolicyDocuments) {
      formData.set("ownerUserId", "");
    } else {
      formData.set("ownerUserId", currentUserId);
    }

    try {
      const result = await uploadWithProgress(formData, setProgress);

      if (result.status < 200 || result.status > 299 || !result.payload?.data?.document) {
        const errorMessage =
          result.payload?.error?.message ?? "Unable to upload document.";
        setSubmitError(errorMessage);
        setIsSubmitting(false);
        return;
      }

      onUploaded(result.payload.data.document);
      setIsSubmitting(false);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to upload document.");
      setIsSubmitting(false);
    }
  };

  return (
    <SlidePanel
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === "new_version" ? t("uploadPanel.titleNewVersion") : t("uploadPanel.titleCreate")}
      description={
        mode === "new_version"
          ? t("uploadPanel.descriptionNewVersion")
          : t("uploadPanel.descriptionCreate")
      }
    >
      <form className="settings-form" noValidate onSubmit={handleSubmit}>
        <label className="form-field" htmlFor="document-title">
          <span className="form-label">{t("uploadPanel.labelTitle")}</span>
          <input
            id="document-title"
            className={errors.title ? "form-input form-input-error" : "form-input"}
            type="text"
            value={values.title}
            onChange={handleFieldChange("title")}
            onBlur={handleFieldBlur("title")}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "document-title-error" : undefined}
          />
          {errors.title ? (
            <p id="document-title-error" className="form-field-error" role="alert">
              {errors.title}
            </p>
          ) : null}
        </label>

        <label className="form-field" htmlFor="document-description">
          <span className="form-label">{t("uploadPanel.labelDescription")}</span>
          <textarea
            id="document-description"
            className={errors.description ? "form-input form-input-error" : "form-input"}
            rows={4}
            value={values.description}
            onChange={handleFieldChange("description")}
            onBlur={handleFieldBlur("description")}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "document-description-error" : undefined}
          />
          {errors.description ? (
            <p id="document-description-error" className="form-field-error" role="alert">
              {errors.description}
            </p>
          ) : null}
        </label>

        <div className="documents-upload-grid">
          <label className="form-field" htmlFor="document-category">
            <span className="form-label">{t("uploadPanel.labelCategory")}</span>
            <select
              id="document-category"
              className={errors.category ? "form-input form-input-error" : "form-input"}
              value={values.category}
              onChange={handleFieldChange("category")}
              onBlur={handleFieldBlur("category")}
              disabled={isSubmitting || isCategoryLocked}
              aria-invalid={Boolean(errors.category)}
              aria-describedby={errors.category ? "document-category-error" : undefined}
            >
              {visibleCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {getDocumentCategoryLabel(category)}
                </option>
              ))}
            </select>
            {errors.category ? (
              <p id="document-category-error" className="form-field-error" role="alert">
                {errors.category}
              </p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="document-expiry">
            <span className="form-label">{t("uploadPanel.labelExpiryDate")}</span>
            <input
              id="document-expiry"
              className={errors.expiryDate ? "form-input form-input-error" : "form-input"}
              type="date"
              value={values.expiryDate}
              onChange={handleFieldChange("expiryDate")}
              onBlur={handleFieldBlur("expiryDate")}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.expiryDate)}
              aria-describedby={errors.expiryDate ? "document-expiry-error" : undefined}
            />
            {errors.expiryDate ? (
              <p id="document-expiry-error" className="form-field-error" role="alert">
                {errors.expiryDate}
              </p>
            ) : null}
          </label>
        </div>

        <label className="form-field" htmlFor="document-country">
          <span className="form-label">{t("uploadPanel.labelCountry")}</span>
          <select
            id="document-country"
            className={errors.countryCode ? "form-input form-input-error" : "form-input"}
            value={values.countryCode}
            onChange={handleFieldChange("countryCode")}
            onBlur={handleFieldBlur("countryCode")}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.countryCode)}
            aria-describedby={errors.countryCode ? "document-country-error" : undefined}
          >
            {countryOptions.map((option) => (
              <option key={option.value || "none"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.countryCode ? (
            <p id="document-country-error" className="form-field-error" role="alert">
              {errors.countryCode}
            </p>
          ) : null}
        </label>

        <div className="form-field">
          <span className="form-label">{t("uploadPanel.labelFileUpload")}</span>
          <div
            className={isDragging ? "document-dropzone document-dropzone-active" : "document-dropzone"}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label={t("uploadPanel.dropzoneAriaLabel")}
          >
            <p className="document-dropzone-title">
              {t("uploadPanel.dropzoneTitle")}
            </p>
            <p className="document-dropzone-hint">
              {t("uploadPanel.dropzoneHint")}
            </p>
            <input
              ref={fileInputRef}
              className="document-hidden-file-input"
              type="file"
              accept={uploadAcceptValue}
              onChange={handleFileInputChange}
              disabled={isSubmitting}
            />
          </div>
          {selectedFile ? (
            <p className="document-selected-file">
              {selectedFile.name} ({formatFileSize(selectedFile.size)})
            </p>
          ) : null}
          {errors.file ? (
            <p className="form-field-error" role="alert">
              {errors.file}
            </p>
          ) : null}
        </div>

        {isSubmitting ? (
          <div className="document-upload-progress">
            <div className="document-upload-progress-track">
              <div className="document-upload-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="document-upload-progress-label numeric">{t("uploadPanel.progressLabel", { progress })}</p>
          </div>
        ) : null}

        {submitError ? (
          <p className="form-submit-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="slide-panel-actions">
          <button type="button" className="button" onClick={handleClose} disabled={isSubmitting}>
            {t("uploadPanel.cancel")}
          </button>
          <button type="submit" className="button button-accent" disabled={isSubmitting}>
            {isSubmitting
              ? t("uploadPanel.uploading")
              : mode === "new_version"
                ? t("uploadPanel.submitNewVersion")
                : t("uploadPanel.submitCreate")}
          </button>
        </div>
      </form>
    </SlidePanel>
  );
}
