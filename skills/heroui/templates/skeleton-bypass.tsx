/**
 * LoadingSkeleton — render HeroUI `Skeleton` only while loading; afterwards return children directly.
 *
 * WHY
 *   heroui-native `Skeleton` (1.0.x) still runs its hooks (window dimensions, shared value, root animation,
 *   memoized contexts) and wraps children in an `Animated.View` with entering/exiting layout animations when
 *   `isLoading` is false. On data-dense screens with one Skeleton per field that is hundreds of extra hooks
 *   and views after the data arrived. Bypassing it once loaded measured: UI-thread p95 65 → 42 ms,
 *   slow frames 442 → 68 on a production profile screen.
 *
 * TRADE-OFF
 *   No skeleton → content fade. If you want one, apply it once per section, not per text node.
 *
 * USAGE
 *   <LoadingSkeleton isLoading={isLoading} className="h-6 w-24 rounded-md" accessibilityLabel={t("loading.balance")}>
 *     <Text className="text-xl text-foreground">{balance ?? "-"}</Text>
 *   </LoadingSkeleton>
 *
 * ADAPT
 *   - `className` sizes the placeholder; match the loaded node's dimensions to avoid layout shift.
 *   - `accessibilityLabel` is announced with busy state while loading; pass a localized string (i18n).
 *   - For several placeholders sharing one loading flag, use `SkeletonGroup` from "heroui-native/skeleton-group"
 *     the same way: render the group only while loading.
 */
import { Skeleton, type SkeletonProps } from "heroui-native/skeleton";
import { memo, type ReactNode } from "react";
import { View } from "react-native";

type LoadingSkeletonProps = {
  isLoading?: boolean;
  /** Real content. Rendered as-is (no wrapper) once loading is done. */
  children?: ReactNode;
  /** Placeholder size/shape, e.g. "h-4 w-28 rounded-md". */
  className?: string;
  /** Localized "Loading balance"-style label for screen readers. Defaults to "Loading". */
  accessibilityLabel?: string;
  variant?: SkeletonProps["variant"];
};

export const LoadingSkeleton = memo(function LoadingSkeleton({
  isLoading = false,
  children,
  className,
  accessibilityLabel = "Loading",
  variant,
}: LoadingSkeletonProps) {
  if (!isLoading) return <>{children}</>;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
    >
      <Skeleton
        isLoading
        variant={variant}
        className={className}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
});
