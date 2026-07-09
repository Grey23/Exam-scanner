import { QuestionGeneratorPage } from './question-generator.page';

describe('QuestionGeneratorPage', () => {
  let component: QuestionGeneratorPage;

  beforeEach(() => {
    component = new QuestionGeneratorPage(
      { snapshot: { paramMap: { get: () => null } } } as any,
      {} as any,
      { create: jasmine.createSpy('create') } as any
    );
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should store a pending PDF file for confirmation before processing', () => {
    const file = new File(['lesson'], 'lesson.pdf', { type: 'application/pdf' });

    component.setPendingPdfFile(file);

    expect(component.pendingPdfFile).toBe(file);
    expect(component.showPdfConfirmation).toBeTrue();
  });

  it('should clear the pending PDF file when cancelled', () => {
    const file = new File(['lesson'], 'lesson.pdf', { type: 'application/pdf' });

    component.setPendingPdfFile(file);
    component.cancelPendingPdfSelection();

    expect(component.pendingPdfFile).toBeNull();
    expect(component.showPdfConfirmation).toBeFalse();
  });
});
