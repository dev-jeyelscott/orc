"use client"

import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"
import { ArrowDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Provides the shared message-scroller state for one conversation transcript. */
function MessageScrollerProvider(
  props: React.ComponentProps<
    typeof MessageScrollerPrimitive.Provider
  >,
) {
  return (
    <MessageScrollerPrimitive.Provider
      {...props}
    />
  )
}

/** Lays out the complete message transcript viewport and its scroll controls. */
function MessageScroller({
  className,
  ...props
}: React.ComponentProps<
  typeof MessageScrollerPrimitive.Root
>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

/** Renders the keyboard-accessible scrolling viewport for the conversation transcript. */
function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<
  typeof MessageScrollerPrimitive.Viewport
>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] data-pending-scroll:invisible",
        className,
      )}
      {...props}
    />
  )
}

/** Contains the ordered message rows and exposes the transcript as the scroller's content. */
function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<
  typeof MessageScrollerPrimitive.Content
>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn(
        "flex h-max min-h-full flex-col",
        className,
      )}
      {...props}
    />
  )
}

/** Registers one stable transcript row for anchoring, visibility, and position preservation. */
function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<
  typeof MessageScrollerPrimitive.Item
>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className,
      )}
      {...props}
    />
  )
}

/** Renders the self-managed control that returns the reader to the transcript edge. */
function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...props
}: React.ComponentProps<
  typeof MessageScrollerPrimitive.Button
> &
  Pick<
    React.ComponentProps<typeof Button>,
    "variant" | "size"
  >) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200",
        "data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0",
        "data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100",
        "data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full",
        "data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full",
        "rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className,
      )}
      render={
        render ?? (
          <Button
            variant={variant}
            size={size}
          />
        )
      }
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />

          <span className="sr-only">
            {direction === "end"
              ? "Scroll to end"
              : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
