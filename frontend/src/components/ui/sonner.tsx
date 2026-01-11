import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-white group-[.toaster]:border-destructive",
          success: "group-[.toaster]:bg-emerald-900 group-[.toaster]:text-emerald-100 group-[.toaster]:border-emerald-800",
          warning: "group-[.toaster]:bg-amber-900 group-[.toaster]:text-amber-100 group-[.toaster]:border-amber-800",
          info: "group-[.toaster]:bg-blue-900 group-[.toaster]:text-blue-100 group-[.toaster]:border-blue-800",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
