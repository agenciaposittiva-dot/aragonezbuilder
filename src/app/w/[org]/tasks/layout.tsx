/** A central de tarefas reserva um espaço para o painel lateral de detalhes. */
export default function TasksLayout({ children, panel }: LayoutProps<"/w/[org]/tasks">) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
