import * as React from "react"

import { cn } from "@/lib/utils"

/** Groups consecutive conversation messages while preserving their individual row semantics. */
function MessageGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn(
        "flex min-w-0 flex-col",
        className,
      )}
      {...props}
    />
  )
}

/** Renders one conversation row aligned to the sender or receiver side. */
function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end"
}) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 data-[align=end]:flex-row-reverse",
        className,
      )}
      {...props}
    />
  )
}

/** Provides the avatar slot associated with one conversation message. */
function MessageAvatar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex w-fit shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    />
  )
}

/** Wraps one message's header, visible bubble, and optional footer. */
function MessageContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col wrap-break-word",
        className,
      )}
      {...props}
    />
  )
}

/** Renders sender identity and timestamp metadata above the message surface. */
function MessageHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex max-w-full min-w-0 items-center",
        className,
      )}
      {...props}
    />
  )
}

/** Renders message actions or metadata below the visible message surface. */
function MessageFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex max-w-full min-w-0 items-center group-data-[align=end]/message:justify-end",
        className,
      )}
      {...props}
    />
  )
}

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
}
