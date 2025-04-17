import React, { useEffect } from 'react';
import store from '@/stores/store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useSelector } from 'react-redux';
import { RootState } from '@/stores/store';
import { startProcessing, updateProgress, completeProcessing, resetProgress } from '@/stores/progress-slice';
import { FileFormValues } from '@/interfaces/data-interfaces';

export const progressService = {
  _currentStep: 0,
  _totalSteps: 0,
  _formValues: null as FileFormValues | null,

  start: (formValues: FileFormValues) => {
    progressService._currentStep = 0; // Reset current step
    progressService._formValues = formValues;
    progressService._totalSteps = 
    2 + // Base steps (Prepare Data, Get Convex Hull)
     (formValues.visualizeSTKDE ? 1 : 0) + // STKDE steps
      (formValues.visualizeStay ? 1 : 0); // Stay steps
    
    store.dispatch(startProcessing());
  },
  
  update: (status: string = '') => {
    progressService._currentStep++;
    // Get the current progress by dividing the current step by the total steps
    const currentProgress = Math.min(
      Math.round((progressService._currentStep / progressService._totalSteps) * 100),
      99 // Cap at 99% until complete is called
    );
    store.dispatch(updateProgress({ progress: currentProgress, status }));
  },
  
  complete: () => {
    // Clear any references 
    progressService._formValues = null;
    store.dispatch(completeProcessing());
  },
  
  reset: () => {
    progressService._currentStep = 0;
    progressService._totalSteps = 0;
    progressService._formValues = null;
    store.dispatch(resetProgress());
  },
  
  // Helper to create a progress callback for data processing functions
  createProgressCallback: () => {
    return (status: string) => {
      progressService.update(status);
    };
  }
};

const ProgressDialog: React.FC = () => {
  const { isProcessing, progress, status } = useSelector((state: RootState) => state.progress);
  
  // Clean up when dialog closes
  useEffect(() => {
    if (!isProcessing) {
      // Additional cleanup may be needed here
      progressService.reset();
    }
  }, [isProcessing]);

  return (
    <Dialog 
      open={isProcessing} 
      onOpenChange={(open) => {
        // If dialog is being closed and processing is done, allow it
        if (!open && !isProcessing) {
          progressService.reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="space-y-4 py-4">
          <h3 className="text-lg font-medium text-center">Processing Data</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">{status}</span>
              <span className="text-sm font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProgressDialog;

