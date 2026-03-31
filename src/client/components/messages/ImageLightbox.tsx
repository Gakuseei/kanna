import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ImageAttachment } from "../../../shared/types"
import { resolveServerUrl } from "../../lib/runtime"
import { Button } from "../ui/button"
import { Dialog, DialogContent } from "../ui/dialog"

interface Props {
  attachments: ImageAttachment[]
  activeIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onActiveIndexChange: (index: number) => void
}

export function ImageLightbox({
  attachments,
  activeIndex,
  open,
  onOpenChange,
  onActiveIndexChange,
}: Props) {
  const activeAttachment = attachments[activeIndex]
  const showNavigation = attachments.length > 1

  if (!activeAttachment) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="max-w-[min(94vw,1120px)] w-[94vw] border-none bg-transparent shadow-none p-0 overflow-visible"
        onKeyDown={(event) => {
          if (!showNavigation) return
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            onActiveIndexChange((activeIndex - 1 + attachments.length) % attachments.length)
          }
          if (event.key === "ArrowRight") {
            event.preventDefault()
            onActiveIndexChange((activeIndex + 1) % attachments.length)
          }
        }}
      >
        <div className="relative flex min-h-[60vh] items-center justify-center">
          <img
            src={resolveServerUrl(activeAttachment.url)}
            alt={activeAttachment.fileName}
            className="max-h-[88vh] w-auto max-w-full rounded-3xl border border-white/10 bg-black/40 object-contain shadow-2xl"
          />

          {showNavigation ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Previous image"
                onClick={() => onActiveIndexChange((activeIndex - 1 + attachments.length) % attachments.length)}
                className="absolute left-4 h-11 w-11 rounded-full bg-background/85 backdrop-blur-sm"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Next image"
                onClick={() => onActiveIndexChange((activeIndex + 1) % attachments.length)}
                className="absolute right-4 h-11 w-11 rounded-full bg-background/85 backdrop-blur-sm"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          ) : null}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            {activeAttachment.fileName}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
