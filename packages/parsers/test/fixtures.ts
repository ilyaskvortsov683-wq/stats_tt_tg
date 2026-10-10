// Маленькие синтетические экспорты для тестов. Реальные данные в репозиторий не кладём.
export const POISON = 'POISON_TEXT_42';

export const tgPersonal = {
  name: 'Аня',
  type: 'personal_chat',
  id: 123456789,
  messages: [
    { id: 1, type: 'message', date: '2025-01-02T13:45:10', date_unixtime: '1735814710', from: 'Аня', from_id: 'user1', text: 'привет ' + POISON, text_entities: [{ type: 'plain', text: 'привет ' + POISON }] },
    { id: 2, type: 'message', date: '2025-01-02T13:46:00', date_unixtime: '1735814760', from: 'Кирилл', from_id: 'user2', text: ['смотри ', { type: 'link', text: 'https://example.com' }], text_entities: [{ type: 'plain', text: 'смотри ' }, { type: 'link', text: 'https://example.com' }] },
    { id: 3, type: 'message', date: '2025-01-02T13:47:00', date_unixtime: '1735814820', from: 'Аня', from_id: 'user1', text: 'ахахаха', text_entities: [{ type: 'plain', text: 'ахахаха' }], reactions: [{ type: 'emoji', count: 1, emoji: '❤', recent: [{ from: 'Кирилл', from_id: 'user2', date: '2025-01-02T13:48:00' }] }] },
    { id: 4, type: 'message', date: '2025-01-02T23:10:00', date_unixtime: '1735848600', from: 'Кирилл', from_id: 'user2', media_type: 'voice_message', duration_seconds: 12, text: '', text_entities: [] },
    { id: 5, type: 'message', date: '2025-01-03T00:30:00', date_unixtime: '1735853400', from: null, from_id: 'user3', text: 'я удалился', text_entities: [{ type: 'plain', text: 'я удалился' }] },
    { id: 6, type: 'service', date: '2025-01-03T01:00:00', date_unixtime: '1735855200', actor: 'Аня', actor_id: 'user1', action: 'phone_call', duration_seconds: 300, text: '', text_entities: [] },
    { id: 7, type: 'message', date: '2025-01-03T09:00:00', date_unixtime: '1735884000', from: 'Аня', from_id: 'user1', forwarded_from: 'Канал X', text: 'репост', text_entities: [{ type: 'plain', text: 'репост' }] },
  ],
};

export const tgFull = { chats: { list: [tgPersonal, { name: 'Пусто', type: 'private_group', id: 5, messages: [] }] } };

export const ttExportA = {
  Profile: { 'Profile Info': { ProfileMap: { userName: 'me_user' } } },
  'Your Activity': {
    'Watch History': { VideoList: [
      { Date: '2025-03-01 21:14:05', Link: 'https://www.tiktokv.com/share/video/7341234567890123456/' },
      { Date: '2025-03-01 21:15:00', Link: 'https://www.tiktokv.com/share/video/7341234567890123456/' },
      { Date: '2025-03-01 21:16:00', Link: 'https://www.tiktokv.com/share/video/7341234567890000000/' },
    ] },
    'Like List': { ItemFavoriteList: [{ date: '2025-03-02 10:00:00', link: 'x' }] },
    'Login History': { LoginHistoryList: [{ Date: '2025-03-01 08:00:00', IP: '1.2.3.4', DeviceModel: 'phone' }] },
  },
  'Direct Message': { 'Direct Messages': { ChatHistory: {
    'Chat History with friend_1:': [
      { Date: '2025-03-01 10:00:00', From: 'friend_1', Content: 'https://www.tiktokv.com/share/video/1/' },
      { Date: '2025-03-01 10:01:00', From: 'me_user', Content: 'ору ' + POISON },
    ],
  } } },
  'Some New Section': {},
};

export const ttExportB = {
  'Your Activity': {
    'watch history': { videolist: [
      { date: '2025-03-01 21:16:00', link: 'https://www.tiktokv.com/share/video/7341234567890000000/' },
      { date: '2025-03-05 12:00:00', link: 'https://www.tiktokv.com/share/video/9/' },
    ] },
  },
};
