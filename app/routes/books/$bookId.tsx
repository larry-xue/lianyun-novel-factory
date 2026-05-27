import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/books/$bookId')({
  component: BookLayout,
});

function BookLayout() {
  return <Outlet />;
}
