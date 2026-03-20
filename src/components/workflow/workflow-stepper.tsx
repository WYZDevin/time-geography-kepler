import React from 'react';
import { Check } from 'lucide-react';

type WorkflowStep = 'tool-selection' | 'options' | 'visualization';

interface WorkflowStepperProps {
    currentStep: WorkflowStep;
    onStepClick?: (step: WorkflowStep) => void;
}

const steps: { id: WorkflowStep; label: string; number: number }[] = [
    { id: 'tool-selection', label: 'Select Tool', number: 1 },
    { id: 'options', label: 'Configure', number: 2 },
    { id: 'visualization', label: 'Results', number: 3 }
];

const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ currentStep, onStepClick }) => {
    const currentStepIndex = steps.findIndex(s => s.id === currentStep);

    const getStepState = (stepIndex: number): 'completed' | 'current' | 'upcoming' => {
        if (stepIndex < currentStepIndex) return 'completed';
        if (stepIndex === currentStepIndex) return 'current';
        return 'upcoming';
    };

    const canNavigateToStep = (stepIndex: number): boolean => {
        return stepIndex < currentStepIndex;
    };

    return (
        <div className="flex items-center justify-center w-full py-4 px-6 bg-white border-b border-gray-200">
            {steps.map((step, index) => {
                const state = getStepState(index);
                const isClickable = canNavigateToStep(index) && onStepClick;

                return (
                    <React.Fragment key={step.id}>
                        {/* Step Circle */}
                        <div
                            className={`flex items-center ${isClickable ? 'cursor-pointer' : ''}`}
                            onClick={() => isClickable && onStepClick(step.id)}
                        >
                            <div className="flex flex-col items-center">
                                <div
                                    className={`
                                        w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm
                                        transition-all duration-200
                                        ${state === 'completed'
                                            ? 'bg-green-500 text-white'
                                            : state === 'current'
                                            ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                                            : 'bg-gray-200 text-gray-500'
                                        }
                                        ${isClickable ? 'hover:ring-4 hover:ring-blue-100' : ''}
                                    `}
                                >
                                    {state === 'completed' ? (
                                        <Check className="w-5 h-5" />
                                    ) : (
                                        <span>{step.number}</span>
                                    )}
                                </div>
                                <span
                                    className={`
                                        mt-2 text-xs font-medium whitespace-nowrap
                                        ${state === 'current' ? 'text-blue-600' : 'text-gray-600'}
                                    `}
                                >
                                    {step.label}
                                </span>
                            </div>
                        </div>

                        {/* Connector Line */}
                        {index < steps.length - 1 && (
                            <div
                                className={`
                                    h-0.5 w-16 mx-2 transition-all duration-200
                                    ${state === 'completed' ? 'bg-green-500' : 'bg-gray-300'}
                                `}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default WorkflowStepper;
