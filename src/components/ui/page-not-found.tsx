import { ButtonLink } from './button-link';
import { EmptyState } from './empty-state';

export function PageNotFound() {
  return (
    <EmptyState
      titleAs="h1"
      title="Page not found"
      description="That page does not exist, or the address is mistyped."
    >
      <ButtonLink href="/documents">Back to your documents</ButtonLink>
    </EmptyState>
  );
}
