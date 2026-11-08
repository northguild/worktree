import { Select } from "@base-ui/react/select";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";
import { cn } from "../../utils";
import type { CHAT_MODELS, ChatModelId } from "../lib/chat-constants";

interface ChatModelSelectProps {
  label: string;
  models: typeof CHAT_MODELS;
  onChange: (model: ChatModelId) => void;
  selectedModel?: ChatModelId;
}

export function ChatModelSelect({
  label,
  models,
  selectedModel,
  onChange,
}: ChatModelSelectProps) {
  const [open, setOpen] = useState(false);

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
  }

  return (
    <Select.Root
      value={selectedModel}
      onValueChange={(m) => m && onChange(m)}
      onOpenChange={handleOpenChange}
      id="model-select"
    >
      <div className="flex items-center gap-2 w-full">
        <label className="text-sm text-chat-muted" htmlFor="model-select">
          {label}:
        </label>
        <Select.Trigger
          className={cn(
            "flex items-center justify-between gap-2 ",
            "px-2 py-1 border rounded w-full",
          )}
          aria-label={label}
        >
          <Select.Value placeholder="Select model" />
          <Select.Icon>
            {open ? (
              <ChevronUpIcon className="w-4 h-4 text-chat-muted" />
            ) : (
              <ChevronDownIcon className="w-4 h-4 text-chat-muted" />
            )}
          </Select.Icon>
        </Select.Trigger>
      </div>

      <Select.Portal>
        <Select.Positioner
          sideOffset={8}
          positionMethod="fixed"
          alignItemWithTrigger={false}
          className="z-[10001]"
        >
          <Select.Popup className="bg-chat-bg border border-chat-border rounded shadow-lg">
            <Select.ScrollUpArrow className="text-chat-fg" />
            <Select.List>
              {models.map(({ label, id }) => (
                <Select.Item
                  key={id}
                  value={id}
                  className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-chat-fill data-[highlighted]:bg-chat-fill"
                >
                  <Select.ItemIndicator>
                    <CheckIcon className="text-chat-accent-ink" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className="text-chat-fg" />
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
