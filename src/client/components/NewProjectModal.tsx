import { useState, useEffect, useRef } from "react"
import { DEFAULT_NEW_PROJECT_ROOT } from "../../shared/branding"
import type { HermesSshSettings } from "../../shared/types"
import { parseHermesSshCommand } from "../lib/hermesSshCommand"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { SegmentedControl } from "./ui/segmented-control"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (project: {
    mode: Tab
    localPath: string
    title: string
    hermesSshSettings?: HermesSshSettings
  }) => Promise<void>
}

type Tab = "new" | "existing" | "ssh"

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function NewProjectModal({ open, onOpenChange, onConfirm }: Props) {
  const [tab, setTab] = useState<Tab>("new")
  const [name, setName] = useState("")
  const [existingPath, setExistingPath] = useState("")
  const [sshCommand, setSshCommand] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const existingInputRef = useRef<HTMLInputElement>(null)
  const sshInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTab("new")
      setName("")
      setExistingPath("")
      setSshCommand("")
      setSubmitError(null)
      setIsSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (tab === "new") inputRef.current?.focus()
        else if (tab === "existing") existingInputRef.current?.focus()
        else sshInputRef.current?.focus()
      }, 0)
    }
  }, [tab, open])

  const kebab = toKebab(name)
  const newPath = kebab ? `${DEFAULT_NEW_PROJECT_ROOT}/${kebab}` : ""
  const trimmedExisting = existingPath.trim()
  const trimmedSshCommand = sshCommand.trim()
  const sshPreview = trimmedSshCommand
    ? (() => {
      try {
        return {
          parsed: parseHermesSshCommand(trimmedSshCommand),
          error: null,
        }
      } catch (error) {
        return {
          parsed: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })()
    : { parsed: null, error: null }

  const canSubmit = tab === "new"
    ? Boolean(kebab)
    : tab === "existing"
      ? Boolean(trimmedExisting)
      : sshPreview.parsed !== null

  const handleSubmit = async () => {
    if (!canSubmit) return

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      if (tab === "new") {
        await onConfirm({ mode: "new", localPath: newPath, title: name.trim() })
      } else if (tab === "existing") {
        const folderName = trimmedExisting.split("/").pop() || trimmedExisting
        await onConfirm({ mode: "existing", localPath: trimmedExisting, title: folderName })
      } else {
        await onConfirm({
          mode: "ssh",
          localPath: sshPreview.parsed!.localPath,
          title: sshPreview.parsed!.title,
          hermesSshSettings: sshPreview.parsed!.settings,
        })
      }
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogBody className="space-y-4">
          <DialogTitle>Add Project</DialogTitle>

          <SegmentedControl
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "new" as Tab, label: "New Folder" },
              { value: "existing" as Tab, label: "Existing Path" },
              { value: "ssh" as Tab, label: "SSH Command" },
            ]}
            className="w-full mb-2"
            optionClassName="flex-1 justify-center"
          />

          {tab === "new" ? (
            <div className="space-y-2">
              <Input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="Project name"
              />
              {newPath && (
                <p className="text-xs text-muted-foreground font-mono">
                  {newPath}
                </p>
              )}
            </div>
          ) : tab === "existing" ? (
            <div className="space-y-2">
              <Input
                ref={existingInputRef}
                type="text"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="~/Projects/my-app"
              />
              <p className="text-xs text-muted-foreground">
                The folder will be created if it doesn't exist.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                ref={sshInputRef}
                type="text"
                value={sshCommand}
                onChange={(e) => setSshCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="ssh -p 2222 hermes@nexus.tail35c782.ts.net"
              />
              {sshPreview.parsed ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Hermes host: <span className="font-mono text-foreground">{sshPreview.parsed.title}</span></p>
                  <p>Local project path: <span className="font-mono text-foreground">{sshPreview.parsed.localPath}</span></p>
                </div>
              ) : sshPreview.error ? (
                <p className="text-xs text-destructive">
                  {sshPreview.error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This saves the Hermes SSH settings and opens a new remote chat.
                </p>
              )}
            </div>
          )}
          {submitError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
            className={cn(isSubmitting && "opacity-80")}
          >
            {isSubmitting ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
