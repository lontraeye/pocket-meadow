// Estado da conexão com o servidor, compartilhado pelo app todo (6.5).
// Quem decide é a própria api(): requisição que falha por rede ou estoura o
// tempo marca offline; qualquer resposta do servidor marca online de novo.
// O App mostra o aviso e tenta recarregar o /state enquanto estiver offline.

export const connection = $state({ offline: false })

export function markOnline(): void {
  if (connection.offline) connection.offline = false
}

export function markOffline(): void {
  if (!connection.offline) connection.offline = true
}
