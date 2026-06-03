import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../stores/store';
import { goBackStep, resetWorkflow } from '../stores/workflow-slice';
import { saveProject } from '../services/persistence-service';

interface KeyboardShortcut {
    key: string;
    ctrlOrMeta?: boolean;
    handler: () => void;
    description: string;
}

export const useKeyboardShortcuts = () => {
    const dispatch = useDispatch();
    const { currentStep } = useSelector((state: RootState) => state.workflow);
    const dataSources = useSelector((state: RootState) => state.data.dataSources);
    const selectedIds = useSelector((state: RootState) => state.data.selectedIds);

    const shortcuts: KeyboardShortcut[] = [
        {
            key: 's',
            ctrlOrMeta: true,
            handler: () => {
                saveProject(dataSources, selectedIds)
                    .then(() => console.log('Project saved via keyboard shortcut'))
                    .catch((error) => console.error('Failed to save project:', error));
            },
            description: 'Save project'
        },
        {
            key: 'Escape',
            handler: () => {
                if (currentStep !== 'tool-selection') {
                    dispatch(goBackStep());
                }
            },
            description: 'Go back / Cancel'
        },
        {
            key: 'h',
            ctrlOrMeta: true,
            handler: () => {
                dispatch(resetWorkflow());
            },
            description: 'Return to home'
        }
    ];

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // Ignore shortcuts when typing in input fields
        const target = event.target as HTMLElement;
        if (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
        ) {
            return;
        }

        for (const shortcut of shortcuts) {
            const ctrlOrMeta = event.ctrlKey || event.metaKey;
            const matchesModifier = shortcut.ctrlOrMeta ? ctrlOrMeta : !ctrlOrMeta;
            const matchesKey = event.key.toLowerCase() === shortcut.key.toLowerCase();

            if (matchesModifier && matchesKey) {
                event.preventDefault();
                shortcut.handler();
                break;
            }
        }
    }, [currentStep, dispatch, dataSources, selectedIds]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    return shortcuts;
};
