"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface StatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  okLabel?: string
  onClose?: () => void
}

export function StatusDialog({
  open,
  onOpenChange,
  title,
  description,
  okLabel = "OK",
  onClose,
}: StatusDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "default" }))}
            onClick={() => {
              onOpenChange(false)
              onClose?.()
            }}
          >
            {okLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
