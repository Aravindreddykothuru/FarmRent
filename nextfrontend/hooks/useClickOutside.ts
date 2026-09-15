import { useEffect, useRef, type RefObject } from 'react';

export interface UseClickOutsideOptions {
    /** Array of refs to treat as "inside" the component (e.g., trigger button + dropdown panel) */
    refs: Array<RefObject<HTMLElement | null>>;
    /** Callback fired when an interaction is detected outside all provided refs */
    handler: (event: MouseEvent | TouchEvent | KeyboardEvent) => void;
    /** Whether the click-outside listener is currently active (default: true) */
    enabled?: boolean;
    /** Close when the Escape key is pressed (default: true) */
    closeOnEscape?: boolean;
}

/**
 * Custom React hook for robust, accessible outside-click and Escape key detection.
 * 
 * Guarantees:
 * 1. Clicks INSIDE any specified ref do NOT trigger the handler (preserves Next.js <Link> clicks).
 * 2. Clicks OUTSIDE all specified refs trigger the handler to close the dropdown/popover.
 * 3. Pressing 'Escape' closes the dropdown gracefully.
 * 4. Listeners are dynamically attached only when `enabled` is true, ensuring zero memory leaks.
 */
export function useClickOutside({
    refs,
    handler,
    enabled = true,
    closeOnEscape = true,
}: UseClickOutsideOptions) {
    const savedHandler = useRef(handler);

    // Keep handler ref updated to avoid stale closures in effects
    useEffect(() => {
        savedHandler.current = handler;
    }, [handler]);

    useEffect(() => {
        if (!enabled) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (!target) return;

            // Check if click target is inside ANY of the registered container refs
            const isInside = refs.some(ref => {
                const el = ref.current;
                return el ? el.contains(target) : false;
            });

            // If target is outside all refs, trigger outside click handler
            if (!isInside) {
                savedHandler.current(event);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (closeOnEscape && event.key === 'Escape') {
                savedHandler.current(event);
            }
        };

        // Attach event listeners
        document.addEventListener('click', handleClickOutside, true);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('click', handleClickOutside, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [enabled, refs, closeOnEscape]);
}
