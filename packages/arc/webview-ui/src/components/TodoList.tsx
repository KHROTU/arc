import { Check, Circle, CircleDot, AlertTriangle, StopCircle } from "./icons";
export type TodoItemUI = { id: string; text: string; state: string; children?: TodoItemUI[] };
export function TodoList({ items, level }: { items: TodoItemUI[]; level: number }) {
  return (
    <ul className="arc-todo-sidebar-list" style={level > 0 ? { marginLeft: 12, marginTop: 2, borderLeft: "1px solid var(--arc-line-faint)", paddingLeft: 8 } : {}}>
      {items.map((t) => (
        <li key={t.id}>
          <div className={`arc-todo-sidebar-item arc-todo-sidebar-item-${t.state}`}>
            <span className="arc-todo-sidebar-mark">
              {t.state === "done" ? <Check size={11} strokeWidth={2.5} /> : t.state === "in_progress" ? <CircleDot size={11} /> : t.state === "failed" ? <AlertTriangle size={11} /> : t.state === "blocked" ? <StopCircle size={11} /> : <Circle size={10} />}
            </span>
            <span className="arc-todo-sidebar-text">{t.text}</span>
          </div>
          {t.children && t.children.length > 0 && <TodoList items={t.children} level={level + 1} />}
        </li>
      ))}
    </ul>
  );
}