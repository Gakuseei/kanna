import { useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ImageAttachment } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { createMarkdownComponents } from "./shared"
import { ImageLightbox } from "./ImageLightbox"

interface Props {
  content: string
  attachments?: ImageAttachment[]
}

function attachmentGridClass(count: number) {
  if (count <= 1) {
    return "grid-cols-1 max-w-[360px]"
  }
  return "grid-cols-2 max-w-[420px]"
}

export function UserMessage({ content, attachments = [] }: Props) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)
  const hasContent = content.trim().length > 0
  const hasAttachments = attachments.length > 0

  if (!hasContent && !hasAttachments) {
    return null
  }

  return (
    <>
      <div className="flex justify-end">
        <div className="flex max-w-[85%] sm:max-w-[80%] flex-col items-end gap-2">
          {hasContent ? (
            <div className="rounded-[20px] border border-border bg-muted px-3.5 py-1.5 text-primary prose prose-sm prose-invert [&_p]:whitespace-pre-line">
              <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>
                {content}
              </Markdown>
            </div>
          ) : null}

          {hasAttachments ? (
            <div className={cn("grid gap-2", attachmentGridClass(attachments.length))}>
              {attachments.map((attachment, index) => (
                <button
                  key={attachment.id}
                  type="button"
                  className="group overflow-hidden rounded-[22px] border border-border bg-muted text-left"
                  onClick={() => setActiveImageIndex(index)}
                >
                  <img
                    src={attachment.url}
                    alt={attachment.fileName}
                    loading="lazy"
                    className={cn(
                      "w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
                      attachments.length === 1 ? "max-h-[320px]" : "h-40"
                    )}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <ImageLightbox
        attachments={attachments}
        activeIndex={activeImageIndex ?? 0}
        open={activeImageIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveImageIndex(null)
          }
        }}
        onActiveIndexChange={setActiveImageIndex}
      />
    </>
  )
}
