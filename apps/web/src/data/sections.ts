// Тексты сводок для экрана выбора. Тариф (free) приходит с сервера (/catalog → config/tiers.yaml).

export interface SectionInfo {
  id: string;
  title: string;
  description: string;
  free: boolean;
  only?: 'personal' | 'group';
  beta?: boolean;
  needs?: 'words' | 'names' | 'chat';
}

export const TG_SECTIONS: SectionInfo[] = [
  { id: 'tg.overview', title: 'Общее', description: 'Сколько всего сообщений и сколько у каждого', free: true },
  { id: 'tg.rhythm', title: 'Ритм', description: 'По дням, неделям и месяцам, топ-10 дней, последние две недели', free: false },
  { id: 'tg.clock', title: 'Часы и дни', description: 'Во сколько и в какие дни недели вы пишете, тепловая карта', free: false },
  { id: 'tg.dialog', title: 'Диалог', description: 'Кто пишет первым, скорость ответа, серии дней и самые долгие паузы', free: false },
  { id: 'tg.moments', title: 'Монологи и диалоги', description: 'Самые длинные монологи и разговоры — по сообщениям, словам и времени. Их можно сохранить', free: false },
  { id: 'tg.media', title: 'Медиа', description: 'Голосовые и кружки (минуты), стикеры, фото, пересланное и откуда', free: false },
  { id: 'tg.words', title: 'Слова', description: 'Любимые слова каждого и счёт ваших слов или масок', free: false, needs: 'words' },
  { id: 'tg.laugh_swear', title: 'Смех и мат', description: '«Ахаха»-индекс и мат по участникам и по времени', free: false },
  { id: 'tg.names', title: 'Имена', description: 'Упоминания имён во всех формах: Саша, Сашке, Александру…', free: false, needs: 'names' },
  { id: 'tg.reactions', title: 'Реакции и эмодзи', description: 'Какие реакции, кто кому ставит, любимые эмодзи и стикеры', free: false },
  { id: 'tg.group_life', title: 'Жизнь беседы', description: 'История названий и новые участники', free: false, only: 'group' },
];

export const TT_SECTIONS: SectionInfo[] = [
  { id: 'tt.views_total', title: 'Просмотры — итог', description: 'Сколько видео вы посмотрели и за какой период', free: true },
  { id: 'tt.chats_counts', title: 'Чаты — счётчики', description: 'Сколько сообщений и тиктоков в каждом чате', free: true },
  { id: 'tt.views_rhythm', title: 'Ритм просмотров', description: 'По дням, часам и дням недели', free: false },
  { id: 'tt.sessions', title: 'Сессии и экранное время', description: 'Сколько часов в ленте, самые долгие «залипания»', free: false },
  { id: 'tt.activity', title: 'Лайки, избранное, входы', description: 'Активность по месяцам и часам', free: false },
  { id: 'tt.chat_deep', title: 'Разбор чата', description: 'Кто кому сколько тиктоков прислал — выберите один чат', free: false, needs: 'chat' },
  { id: 'tt.emoji', title: 'Эмодзи', description: 'Любимые эмодзи в выбранном чате', free: false, needs: 'chat' },
  { id: 'tt.content', title: 'Содержание просмотренного', description: 'Авторы и хэштеги (бета, скоро)', free: false, beta: true },
];
