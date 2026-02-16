import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UserQuestionEvent } from '@/types';

interface UserQuestionDialogProps {
  question: UserQuestionEvent | null;
  onRespond: (questionId: string, answers: Record<string, string>) => void;
}

export function UserQuestionDialog({ question, onRespond }: UserQuestionDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  // Reset state when question changes
  useEffect(() => {
    if (question) {
      setAnswers({});
      setCustomInputs({});
    }
  }, [question?.question_id]);

  if (!question) return null;

  const handleOptionSelect = (questionIndex: number, option: string) => {
    setAnswers(prev => ({
      ...prev,
      [String(questionIndex)]: option,
    }));
    // Clear custom input if selecting a predefined option
    setCustomInputs(prev => {
      const next = { ...prev };
      delete next[String(questionIndex)];
      return next;
    });
  };

  const handleCustomInput = (questionIndex: number, value: string) => {
    setCustomInputs(prev => ({
      ...prev,
      [String(questionIndex)]: value,
    }));
    // Update answer with custom value
    setAnswers(prev => ({
      ...prev,
      [String(questionIndex)]: value,
    }));
  };

  const handleSubmit = () => {
    // Merge selected options with custom inputs
    const finalAnswers: Record<string, string> = {};
    question.questions.forEach((_, idx) => {
      const key = String(idx);
      if (customInputs[key]) {
        finalAnswers[key] = customInputs[key];
      } else if (answers[key]) {
        finalAnswers[key] = answers[key];
      }
    });
    onRespond(question.question_id, finalAnswers);
  };

  const allQuestionsAnswered = question.questions.every(
    (_, idx) => answers[String(idx)] || customInputs[String(idx)]
  );

  return (
    <Dialog open={!!question} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-lg">AI needs your input</span>
          </DialogTitle>
          {question.context && (
            <DialogDescription className="text-muted-foreground">
              {question.context}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-6 py-4">
          {question.questions.map((q, idx) => (
            <div key={idx} className="space-y-3">
              <label className="text-sm font-medium text-foreground">
                {q.question}
              </label>

              {/* Options as chips/buttons */}
              {q.options && q.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => handleOptionSelect(idx, option)}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-full border transition-colors',
                        answers[String(idx)] === option && !customInputs[String(idx)]
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background hover:bg-accent border-input'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {/* Custom text input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder={q.options?.length ? "Or type a custom answer..." : "Type your answer..."}
                  value={customInputs[String(idx)] || ''}
                  onChange={(e) => handleCustomInput(idx, e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-md border bg-background',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                    'placeholder:text-muted-foreground'
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!allQuestionsAnswered}
            className="w-full sm:w-auto"
          >
            Submit Answers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
