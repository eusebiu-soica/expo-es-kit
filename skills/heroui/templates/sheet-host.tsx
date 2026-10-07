/**
 * Single bottom-sheet host + typed registry + useSheets() hook for HeroUI Native.
 *
 * WHY
 *   `BottomSheet.Portal` (heroui-native 1.0.x) always renders its children into the PortalHost; Gorhom just
 *   parks the sheet at index -1. A screen that declares N sheets therefore mounts N sheet bodies on every
 *   visit. This host mounts ONE `BottomSheet` per navigator group and renders only the active body.
 *   Measured in production: 5–7 closed sheets per detail screen removed from the tree.
 *
 * USAGE
 *   // sheets.ts
 *   type SheetPropsMap = {
 *     editNote: { value: string; onSave: (v: string) => void };
 *     pickCountry: { selected?: string; onSelect: (code: string) => void };
 *   };
 *   export const { SheetsProvider, SheetHost, useSheets, useSheetsActions } = createSheetSystem<SheetPropsMap>({
 *     editNote:    { Content: EditNoteSheetContent, config: { keyboardBehavior: "extend" } },
 *     pickCountry: { Content: PickCountrySheetContent, config: { enableDynamicSizing: false, snapPoints: ["60%", "90%"] } },
 *   });
 *
 *   // app/(group)/_layout.tsx  (inside GestureHandlerRootView + HeroUINativeProvider)
 *   <SheetsProvider><Stack /><SheetHost /></SheetsProvider>
 *
 *   // any screen
 *   const { open } = useSheetsActions();          // stable, never re-renders on sheet changes
 *   open("editNote", { value, onSave });
 *
 *   // sheet body: plain component, receives its props + onRequestClose
 *   export function EditNoteSheetContent({ value, onSave, onRequestClose }: SheetContentProps<SheetPropsMap["editNote"]>) { … }
 *
 * ADAPT
 *   - Styling: replace the className strings with your tokens (`bg-overlay` etc. come from HeroUI defaults).
 *   - Haptics: remove the expo-haptics import if not installed (or swap for your haptics helper).
 *   - HANDLE_HEIGHT_PX must match the rendered handle (default handle ≈ 24–36 px; measure once).
 *   - Startup: if the registry imports dozens of bodies, use getters with require() for lazy evaluation.
 *   - Verify against your installed heroui-native: BottomSheet.Content forwards Gorhom props
 *     (snapPoints, enableDynamicSizing, maxDynamicContentSize, keyboardBehavior, onChange). `onChange(-1)`
 *     is used to unmount the body after the close animation; if your version swallows it, fall back to a
 *     ~350 ms timeout in `close()`.
 *   - Nested sheets (sheet opening a sheet) are not supported by design: `open()` replaces the active one.
 */
import * as Haptics from "expo-haptics";
import { BottomSheet } from "heroui-native/bottom-sheet";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { View, useWindowDimensions } from "react-native";

// ---------- types ----------

export type SheetConfig = {
  /** Mode A: fixed snap points + internal BottomSheetScrollView / BottomSheetFlatList. Requires enableDynamicSizing: false. */
  snapPoints?: (string | number)[];
  /** Mode B (default true): sheet hugs content. Combine with maxDynamicContentSizePercent for long content. */
  enableDynamicSizing?: boolean;
  /** Mode B cap, 0–1 of window height. The scrollable inside must also get a matching maxHeight. */
  maxDynamicContentSizePercent?: number;
  /** "extend" / "interactive" for sheets with inputs. */
  keyboardBehavior?: "extend" | "fillParent" | "interactive";
  /** Disable haptic on open for this sheet. */
  silent?: boolean;
};

export type SheetContentProps<P> = P & { onRequestClose: () => void };

export type SheetEntry<P> = {
  Content: ComponentType<SheetContentProps<P>>;
  config?: SheetConfig;
};

export type SheetRegistry<TMap extends Record<string, object>> = {
  [K in keyof TMap]: SheetEntry<TMap[K]>;
};

type Active<TMap> = { [K in keyof TMap]: { key: K; props: TMap[K] } }[keyof TMap];

type SheetsActions<TMap> = {
  open: <K extends keyof TMap>(key: K, props: TMap[K]) => void;
  update: <K extends keyof TMap>(key: K, props: Partial<TMap[K]>) => void;
  close: () => void;
};

type SheetsState<TMap> = {
  /** The body to render; kept during the close animation, cleared after it. */
  active: Active<TMap> | null;
  isOpen: boolean;
};

const HANDLE_HEIGHT_PX = 32;

function snapToPx(snap: string | number, windowHeight: number): number {
  if (typeof snap === "number") return snap;
  const n = Number.parseFloat(snap);
  return snap.trim().endsWith("%") ? (n / 100) * windowHeight : n;
}

/** Pixel height for the body under the handle at the largest snap point (Gorhom's content view has no height). */
export function snapBodyHeightPx(snapPoints: (string | number)[], windowHeight: number): number {
  const largest = Math.max(0, ...snapPoints.map((s) => snapToPx(s, windowHeight)).filter(Number.isFinite));
  return Math.max(0, Math.round(largest) - HANDLE_HEIGHT_PX);
}

/** maxHeight for the scrollable inside a mode-B sheet (subtract your sticky header height too). */
export function dynamicSheetScrollMaxHeightPx(windowHeight: number, percent: number): number {
  return Math.max(0, Math.round(windowHeight * percent) - HANDLE_HEIGHT_PX);
}

// ---------- factory ----------

export function createSheetSystem<TMap extends Record<string, object>>(registry: SheetRegistry<TMap>) {
  const ActionsContext = createContext<SheetsActions<TMap> | null>(null);
  const StateContext = createContext<SheetsState<TMap> | null>(null);

  function SheetsProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<SheetsState<TMap>>({ active: null, isOpen: false });

    const open = useCallback<SheetsActions<TMap>["open"]>((key, props) => {
      setState({ active: { key, props } as Active<TMap>, isOpen: true });
      if (!registry[key].config?.silent) {
        // After the state change so the haptic doesn't compete with the first animation frame.
        requestAnimationFrame(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      }
    }, []);

    const update = useCallback<SheetsActions<TMap>["update"]>((key, props) => {
      setState((s) =>
        s.active && s.active.key === key
          ? { ...s, active: { key, props: { ...s.active.props, ...props } } as Active<TMap> }
          : s,
      );
    }, []);

    const close = useCallback(() => {
      setState((s) => (s.isOpen ? { ...s, isOpen: false } : s));
    }, []);

    /** Internal: drop the body once the close animation finished (and nothing reopened meanwhile). */
    const clearIfClosed = useCallback(() => {
      setState((s) => (s.isOpen || !s.active ? s : { active: null, isOpen: false }));
    }, []);

    const actions = useMemo(() => ({ open, update, close }), [open, update, close]);
    const value = useMemo(() => ({ ...state, clearIfClosed }), [state, clearIfClosed]);

    return (
      <ActionsContext.Provider value={actions}>
        <StateContext.Provider value={value}>{children}</StateContext.Provider>
      </ActionsContext.Provider>
    );
  }

  /** Stable open/update/close. Use this in screens: it never re-renders when the active sheet changes. */
  function useSheetsActions(): SheetsActions<TMap> {
    const ctx = useContext(ActionsContext);
    if (!ctx) throw new Error("useSheetsActions must be used inside SheetsProvider");
    return ctx;
  }

  function useSheetsState(): SheetsState<TMap> & { clearIfClosed: () => void } {
    const ctx = useContext(StateContext) as (SheetsState<TMap> & { clearIfClosed: () => void }) | null;
    if (!ctx) throw new Error("useSheetsState must be used inside SheetsProvider");
    return ctx;
  }

  /** Actions + state. Subscribes to state: avoid in screens that only open sheets. */
  function useSheets() {
    return { ...useSheetsActions(), ...useSheetsState() };
  }

  const SheetBody = memo(function SheetBody({
    Content,
    props,
  }: {
    Content: ComponentType<Record<string, unknown>>;
    props: Record<string, unknown>;
  }) {
    return <Content {...props} />;
  });

  function SheetHost() {
    const { close } = useSheetsActions();
    const { active, isOpen, clearIfClosed } = useSheetsState();
    const { height: windowHeight } = useWindowDimensions();
    const isOpenRef = useRef(isOpen);
    isOpenRef.current = isOpen;

    const entry = active ? (registry[active.key] as SheetEntry<object>) : null;
    const config = entry?.config;
    const usesSnapPoints = Boolean(config?.snapPoints && config.enableDynamicSizing === false);

    const requestClose = useCallback(() => {
      if (isOpenRef.current) close();
    }, [close]);

    // onOpenChange fires for every close path (swipe, overlay, BottomSheet.Close, programmatic).
    const handleOpenChange = useCallback((next: boolean) => {
      if (!next) requestClose();
    }, [requestClose]);

    const handleIndexChange = useCallback((index: number) => {
      if (index === -1) clearIfClosed();
    }, [clearIfClosed]);

    const maxDynamicContentSize = useMemo(
      () =>
        config?.maxDynamicContentSizePercent == null
          ? undefined
          : Math.round(windowHeight * config.maxDynamicContentSizePercent),
      [config?.maxDynamicContentSizePercent, windowHeight],
    );

    const snapBodyStyle = useMemo(
      () =>
        usesSnapPoints && config?.snapPoints
          ? ({ height: snapBodyHeightPx(config.snapPoints, windowHeight), width: "100%" } as const)
          : null,
      [usesSnapPoints, config?.snapPoints, windowHeight],
    );

    const bodyProps = useMemo(
      () => (active ? { ...(active.props as Record<string, unknown>), onRequestClose: requestClose } : null),
      [active, requestClose],
    );

    // One cheap BottomSheet shell stays mounted; the body exists only while a sheet is active.
    const body =
      entry && bodyProps ? (
        <SheetBody Content={entry.Content as ComponentType<Record<string, unknown>>} props={bodyProps} />
      ) : null;

    return (
      <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
        <BottomSheet.Portal>
          {/* Default overlay uses the --backdrop token; translucency is correct here (content behind varies). */}
          <BottomSheet.Overlay />
          <BottomSheet.Content
            index={0}
            enableDynamicSizing={config?.enableDynamicSizing ?? true}
            maxDynamicContentSize={maxDynamicContentSize}
            snapPoints={usesSnapPoints ? config?.snapPoints : undefined}
            enableOverDrag={usesSnapPoints ? false : undefined}
            enablePanDownToClose
            keyboardBehavior={config?.keyboardBehavior ?? "interactive"}
            keyboardBlurBehavior="restore"
            onChange={handleIndexChange}
            contentContainerClassName={usesSnapPoints ? "px-0" : undefined}
          >
            {body && snapBodyStyle ? <View style={snapBodyStyle}>{body}</View> : body}
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    );
  }

  return { SheetsProvider, SheetHost, useSheets, useSheetsActions, useSheetsState };
}
