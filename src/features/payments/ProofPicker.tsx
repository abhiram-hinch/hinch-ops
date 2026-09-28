import { useEffect, useRef, useState } from "react";
import { Paperclip, Upload, X } from "lucide-react";

export const PROOF_ACCEPT = "image/*,application/pdf";

/** image/* or application/pdf, matching the file input's own accept attribute
 *  — dropped and pasted files skip that native filtering, so it's enforced here too. */
export function isAcceptedProofFile(f: File): boolean {
  return f.type.startsWith("image/") || f.type === "application/pdf";
}

/**
 * File picker for payment proofs — click to browse, drag-and-drop, or paste
 * (Cmd/Ctrl+V) a copied screenshot straight in. Paste listens on the whole
 * document rather than requiring focus inside the dropzone, since a screenshot
 * clipboard payload never carries anything a text field would use, so it never
 * steals an ordinary text paste happening elsewhere on the page.
 */
export function ProofPicker({
  proofs,
  setProofs,
  fileRef,
  hint,
  dropHint = "or drag and drop it here",
}: {
  proofs: File[];
  setProofs: React.Dispatch<React.SetStateAction<File[]>>;
  fileRef: React.RefObject<HTMLInputElement>;
  hint?: string;
  dropHint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);
  const dragCounter = useRef(0);

  function acceptFiles(files: FileList | File[]) {
    const all = Array.from(files);
    const accepted = all.filter(isAcceptedProofFile);
    setRejected(accepted.length < all.length);
    if (accepted.length) setProofs(accepted);
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      const accepted = Array.from(files).filter(isAcceptedProofFile);
      if (accepted.length === 0) return;
      e.preventDefault();
      setRejected(accepted.length < files.length);
      setProofs(accepted);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [setProofs]);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={PROOF_ACCEPT}
        multiple
        onChange={(e) => e.target.files && acceptFiles(e.target.files)}
        className="hidden"
      />
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
          setDragging(false);
          if (e.dataTransfer.files.length) acceptFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
          dragging ? "border-brand bg-brandSoft/40" : "border-line"
        }`}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-soft btn-sm gap-1.5"
        >
          <Upload size={13} /> Attach screenshot / PDF
        </button>
        <p className="mt-1.5 text-micro text-faint">
          {dropHint} — or paste with {navigator.platform.startsWith("Mac") ? "⌘V" : "Ctrl+V"}
        </p>
        {proofs.length > 0 && (
          <ul className="mt-2 space-y-1 text-left">
            {proofs.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 text-micro text-ink">
                <Paperclip size={11} className="shrink-0 text-faint" />
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setProofs((cur) => cur.filter((_, j) => j !== i))}
                  className="ml-auto shrink-0 text-faint hover:text-bad"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rejected && (
        <p className="mt-1 text-micro text-bad">Only images and PDFs are accepted — that file was skipped.</p>
      )}
      {hint && proofs.length === 0 && <p className="mt-1 text-micro text-faint">{hint}</p>}
    </>
  );
}
