// Dashboard-facing boundary for the visual primitives owned by the
// StreamSense Chrome extension. Keep feature code importing this facade so a
// future shared package extraction does not require another application-wide
// import rewrite.
export {
  Button,
  buttonVariants,
} from "@/components/ui/button";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export {
  Select,
  SelectContent,
  SelectEmpty,
  SelectGroup,
  SelectInput,
  SelectItem,
  SelectLabel,
  SelectList,
  SelectPopover,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
