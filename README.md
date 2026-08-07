# KLTERMINAL

Ứng dụng terminal desktop cho Windows để chạy Claude Code, kèm khả năng tra cứu lại toàn bộ lịch sử làm việc đã qua.

## Ứng dụng làm được gì

- **Nhiều tab terminal**, mỗi tab là một phiên riêng ở một thư mục riêng. Terminal thật (ConPTY), nên giao diện TUI của Claude Code hiển thị đầy đủ. Tab nằm thẳng trên thanh tiêu đề.
- **Chia đôi màn hình `Ctrl+\`**: hai terminal độc lập cạnh nhau trong cùng một tab — chạy `claude` một bên, `npm run dev` hay `git` bên kia mà không phải nhảy tab. Kéo vạch giữa để đổi tỉ lệ; tỉ lệ và cả hai ô đều được khôi phục khi mở lại app.
- **Bảng lệnh `Ctrl+K`**: gõ vài chữ để nhảy tới dự án, phiên cũ, hoặc chạy lệnh. Khớp mờ kiểu gõ tắt — `qlt` tìm ra `quản lý terminal`.
- **Trạng thái tài khoản Claude** trên thanh trạng thái: gói đang dùng, hạn mức, và thời hạn còn lại của phiên đăng nhập. Có nút đăng nhập/đăng xuất một chạm và quản lý nhiều hồ sơ tài khoản. Xem mục [Tài khoản Claude](#tài-khoản-claude) để biết ranh giới an toàn.
- **Mức sử dụng thời gian thực**: % hạn mức phiên 5 giờ và tuần (kèm giờ reset), % ngữ cảnh của phiên đang chạy, token và chi phí ước tính hôm nay. Đổi màu khi vượt 70% / 90%.
- **Đổi model bằng một nút** trên thanh trạng thái, thay cho việc gõ `/model` mỗi lần. App nhớ model đã chọn cho từng dự án. Đo trên 4.044 prompt thật trong lịch sử: `/model` bị gõ tay **316 lần** trên 65/151 phiên — nhiều gấp 10 lần lệnh phổ biến thứ nhì, và 33 phiên mở đầu bằng đúng lệnh đó.
- **Hàng nút gõ nhanh** phía trên terminal cho những câu lặp đi lặp lại (`tiếp tục` 146 lần, `ok` 36, `/compact` 31…). Bấm là gõ thẳng xuống phiên đang chạy; danh sách sửa được.
- **Kéo-thả file vào terminal** để chèn đường dẫn (tự bọc ngoặc kép khi có khoảng trắng), không tự bấm Enter vì đường dẫn thường chỉ là một phần của câu. 772 prompt trong lịch sử có chứa đường dẫn Windows.
- **Sidebar dự án** tự sinh từ chính lịch sử đã có — mọi thư mục từng chạy `claude` đều xuất hiện, không cần khai báo tay. Chia làm ba mục (ghim / hay dùng / dùng một lần) vì phần lớn dự án chỉ có đúng một phiên.
- **Dọn dự án đã mất**: thư mục nào không còn tồn tại trên đĩa (đã xoá/đổi tên) được đánh dấu riêng, kèm nút dọn hàng loạt ngay trong sidebar. Đo trên máy này: 5/80 dự án rơi vào diện này. Dọn chỉ ẩn khỏi danh sách — lịch sử/transcript gốc vẫn giữ nguyên, tìm kiếm và mở lại vẫn hoạt động.
- **Bỏ qua xin quyền theo từng dự án** (`--dangerously-skip-permissions`): bấm icon tia sét trên hàng dự án để mọi tab Claude mở mới trong thư mục đó tự động không hỏi xin phép khi sửa file/chạy lệnh. Có cảnh báo xác nhận khi bật, và tab đang chạy với cờ này đổi màu chấm tab (đỏ) để không quên đang ở phiên "không hỏi lại". Chỉ áp dụng cho tab mở sau khi bật — tab đang chạy sẵn không đổi được.
- **Chuột phải vào dự án** trong sidebar để mở tab Claude/dòng lệnh tại đó, ghim, bật/tắt bỏ qua xin quyền, mở thư mục bằng File Explorer thật của Windows, hoặc sao chép đường dẫn — gộp mọi thao tác trên một dự án vào một menu thay vì dò icon nhỏ trên hàng.
- **Duyệt lịch sử**: nhóm theo Hôm nay / 7 ngày / 30 ngày, kèm nhánh git của từng phiên. Duyệt bằng ↑↓, nội dung hiện ngay khi di chuyển. Chọn một dự án thì danh sách chuyển sang **gom theo từng ngày** kèm số phiên trong ngày — hợp với cách làm việc dồn theo ngày (dữ liệu thật: có ngày 9 phiên cùng một dự án).
- **Ẩn phiên vụn**: lọc bỏ những phiên mở ra rồi bỏ ngay và phiên do công cụ khác tự sinh (dưới 200KB). Trên máy này nhóm đó chiếm 55/151 phiên. Bật sẵn, tắt được, và phiên đã đánh dấu thì không bao giờ bị ẩn.
- **Đánh dấu sao và ghi chú phiên**: gắn sao cùng một dòng ghi chú cho phiên đáng nhớ. Ghi chú hiện ngay trên danh sách và **tìm kiếm được** — không phải nhớ đúng từ khoá trong hội thoại mới tìm lại được.
- **Tìm kiếm toàn văn** trên toàn bộ lịch sử, thường trả kết quả dưới 300ms.
- **Tìm trong terminal `Ctrl+F`**, có tô sáng và nhảy giữa các kết quả.
- **Mục lục phiên**: phiên dài hiện cột liệt kê các lượt hỏi để nhảy nhanh, tự tô sáng mục đang xem.
- **Nối tiếp phiên cũ**: bấm một nút là mở tab mới chạy `claude --resume` đúng tại thư mục gốc của phiên đó.
- **Giao diện sáng/tối**, mặc định bám theo cài đặt Windows. Bảng màu terminal đổi theo, không bị nền đen giữa giao diện sáng.
- **Lưu scrollback**: nội dung màn hình mỗi tab được ghi ra đĩa, mở lại app vẫn còn, và xuất được ra file văn bản.

## Yêu cầu

- Windows 10/11
- [Node.js](https://nodejs.org/) 18 trở lên
- Claude Code đã cài và gọi được bằng lệnh `claude`

## Chạy thử

```bash
npm install
npm start
```

## Đóng gói thành ứng dụng cài đặt

```bash
npm run dist
```

Bản cài `.exe` nằm trong thư mục `dist/`.

**Cần bật Developer Mode trước.** electron-builder luôn tải gói `winCodeSign` khi build cho Windows, kể cả khi không ký số. Gói này chứa vài symlink của macOS, mà Windows chỉ cho tạo symlink khi có quyền — không bật thì build dừng với lỗi:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
```

Bật tại **Cài đặt → Quyền riêng tư & bảo mật → Dành cho nhà phát triển → Chế độ nhà phát triển**. Hoặc chạy `npm run dist` từ terminal mở bằng quyền Administrator.

Đây là hạn chế của công cụ đóng gói, không liên quan tới mã nguồn: bản đóng gói asar đã được kiểm chứng chạy đúng (giao diện, terminal, và tìm kiếm đều hoạt động từ trong `app.asar`).

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `Ctrl+K` | Bảng lệnh — nhảy tới dự án, phiên, hoặc chạy lệnh |
| `Ctrl+T` | Tab Claude mới |
| `Ctrl+Shift+T` | Tab shell mới |
| `Ctrl+\` | Chia đôi màn hình terminal |
| `Ctrl+]` | Chuyển sang ô bên kia |
| `Ctrl+Shift+W` | Đóng ô đang chọn |
| `Ctrl+W` | Đóng tab |
| `Ctrl+1`…`Ctrl+9` | Chuyển nhanh sang tab thứ n |
| `Ctrl+F` | Tìm trong nội dung terminal |
| `Ctrl+H` | Mở/đóng màn hình lịch sử |
| `Ctrl+Shift+F` | Nhảy vào ô tìm kiếm lịch sử |
| `Ctrl+R` | Quét lại lịch sử |
| `↑` `↓` `Enter` | Duyệt danh sách phiên và bảng lệnh |

## Lịch sử được lấy từ đâu

Ứng dụng **không tự ghi lại hội thoại**. Claude Code vốn đã lưu sẵn mỗi phiên thành một file JSONL tại:

```
%USERPROFILE%\.claude\projects\<thư-mục-đã-mã-hoá>\<session-id>.jsonl
```

Ứng dụng đọc chính những file đó. Nghĩa là mọi phiên bạn từng chạy **trước khi cài app này** đều tra cứu được ngay, và phiên chạy từ terminal khác cũng tự xuất hiện sau khi bấm "Quét lại".

Tên thư mục trong `.claude/projects` bị mã hoá mất mát (ký tự có dấu bị thay bằng `-`) nên không giải mã ngược được. Ứng dụng lấy đường dẫn thật từ trường `cwd` nằm bên trong file transcript.

### Tiêu đề phiên lấy từ đâu

Không dùng thẳng prompt đầu tiên. Đo trên 150 phiên thật cho thấy 37% tiêu đề sẽ vô nghĩa nếu làm vậy — riêng `/model` xuất hiện 34 lần, vì người ta hay gõ `/model` hoặc `/clear` trước rồi mới vào việc. Ứng dụng bỏ qua các prompt chỉ có slash command và lấy câu thực chất đầu tiên; nếu 192KB đầu file chưa có câu nào thì tìm tiếp trong bản cache nội dung (đã lọc sạch nên prompt thật nằm ngay đầu). Kết quả: tỷ lệ tiêu đề vô nghĩa còn 2,7%.

## Tài khoản Claude

Thanh trạng thái hiện gói đang dùng và thời hạn còn lại của phiên đăng nhập. Bấm vào để mở menu tài khoản.

**Ứng dụng không tự làm việc đăng nhập.** Không có ô nhập email hay mật khẩu ở bất kỳ đâu — Claude Code xác thực bằng OAuth qua trình duyệt, và một ứng dụng bên thứ ba hỏi mật khẩu Anthropic là mô hình lừa đảo. Nút "Đăng nhập"/"Đăng xuất" chỉ gõ `/login`, `/logout` xuống terminal để chính Claude Code xử lý.

**Ứng dụng chỉ đọc, không bao giờ ghi vào `.credentials.json`**, và chỉ đọc những trường không bí mật:

| Đọc | Không bao giờ đọc |
|---|---|
| Gói (`max`), hạn mức, số quyền | `accessToken` |
| Thời hạn token (để cảnh báo trước) | `refreshToken` |
| Mã tổ chức (đã che bớt) | |

Token không bao giờ rời khỏi tiến trình main — phần giao diện không nhận được chúng. Lý do: giao diện có hiển thị nội dung transcript, tức dữ liệu không tin cậy, nên phải coi như môi trường có thể bị chèn mã.

### Mức sử dụng

Hai nguồn số liệu, đặc tính khác hẳn nhau nên được xử lý riêng:

| | Hạn mức gói (phiên 5h, tuần) | Ngữ cảnh · chi phí hôm nay |
|---|---|---|
| Lấy từ | `GET /api/oauth/usage` của Anthropic | File `.jsonl` dưới máy |
| Ràng buộc | Có giới hạn tần suất (429) | Không giới hạn, nhưng file rất lớn |
| Nhịp cập nhật | 90 giây, chặn thêm ở main tối thiểu 60 giây | Ngữ cảnh 5 giây · chi phí 5 phút |

Gọi API bắt buộc phải dùng `accessToken`, nhưng token **không rời khỏi tiến trình main** — chỉ phần trăm đi xuống giao diện. Khi API trả 429 hoặc mạng lỗi, ứng dụng **giữ lại số cũ và ghi rõ "số liệu cũ"** thay vì để trống.

Chi phí là **ước tính** theo bảng giá trong `src/main/usage/usage-local.js`, không phải hoá đơn thật. Ngữ cảnh vượt 100% là bình thường với phiên dùng cache dài — lúc đó thanh chuyển đỏ kèm gợi ý `/compact`.

Phần này rút gọn từ công cụ `check use` có sẵn của bạn, viết lại để đọc theo hồ sơ tài khoản đang chọn và không phụ thuộc thư mục ngoài (bản đóng gói `.exe` vẫn chạy).

**Lưu ý về hiệu năng.** Tính chi phí phải quét mọi file được sửa trong ngày — trên máy này mất khoảng 2,3 giây. Vì vậy nó chạy nền và cache 5 phút, còn giao diện lấy % ngữ cảnh trong khoảng 30ms mà không phải chờ. Nếu gộp chung một cache, mỗi lần mở menu sẽ đơ vài giây.

### Nhiều tài khoản

Claude Code đọc biến `CLAUDE_CONFIG_DIR` để biết lấy cấu hình ở đâu, kể cả thông tin đăng nhập lẫn lịch sử phiên. Mỗi hồ sơ trong ứng dụng là một thư mục như vậy.

Đổi hồ sơ sẽ **khởi động lại ứng dụng**. Đây là chủ ý, không phải hạn chế tạm: đường dẫn thư mục cấu hình được tính một lần lúc nạp và nhiều thành phần giữ tham chiếu trực tiếp, nên đổi giữa chừng sẽ khiến lịch sử đã nạp lệch với hồ sơ mới — vừa hiển thị sai, vừa có nguy cơ ghi cache của tài khoản này đè lên tài khoản kia.

## Hai chế độ tìm kiếm

| | Tìm nhanh (mặc định) | Quét sâu |
|---|---|---|
| Phạm vi | Nội dung hội thoại | Thêm tham số và kết quả gọi công cụ |
| Dữ liệu phải đọc | ~22 MB | ~1,8 GB |
| Thời gian | ~0,3 giây | ~15 giây |

Tìm nhanh chạy trên bản cache rút gọn, dựng sẵn lúc lập chỉ mục. Lý do tách ra: đo trên dữ liệu thật cho thấy **phần hội thoại chỉ chiếm 0,6% dung lượng transcript** — phần còn lại là nội dung file và output lệnh mà công cụ đã đọc. Tìm thẳng trên file gốc nghĩa là đọc gần 2GB mỗi lần chỉ để lấy ra vài chục MB có nghĩa.

Bật "Quét sâu (chậm)" khi cần tìm một lệnh đã chạy hay một đường dẫn file, thay vì tìm câu chữ trong hội thoại.

## Dữ liệu ứng dụng tự lưu

Nằm trong `%APPDATA%\claude-terminal\`:

| Nội dung | Mục đích |
|---|---|
| `history-index.json` | Metadata các phiên, để khỏi quét lại từ đầu mỗi lần mở |
| `content-cache/` | Bản hội thoại rút gọn phục vụ tìm nhanh, kèm `manifest.json` ghi bản cache dựng từ phiên bản file nào |
| `scrollback/` | Nội dung màn hình từng tab |
| `tabs.json` | Danh sách tab đang mở (kèm các ô chia đôi và tỉ lệ), để khôi phục lần sau |
| `pinned-projects.json` | Dự án bạn đã ghim |
| `session-notes.json` | Sao và ghi chú bạn gắn cho từng phiên |
| `account-profiles.json` | Danh sách hồ sơ tài khoản (chỉ tên và đường dẫn thư mục, không có token) |
| `settings.json` | Tuỳ chọn giao diện sáng/tối, bộ lọc phiên vụn, nút gõ nhanh, model theo dự án |

Xoá thư mục này là mất trạng thái của app, **không ảnh hưởng** tới lịch sử Claude Code gốc trong `.claude/projects` — lần mở sau app sẽ dựng lại toàn bộ.

## Vài lưu ý về hành vi

- **Tab khôi phục luôn là shell trắng.** Mở lại app không tự chạy `claude` hay `claude --resume`, vì việc đó tiêu tốn token ngoài ý muốn. Nội dung màn hình phiên trước vẫn được vẽ lại phía trên.
- **Không có nút tải lại trang (Ctrl+R được dùng cho việc khác).** Tải lại renderer sẽ huỷ mọi terminal đang hiển thị trong khi tiến trình phía dưới vẫn sống, nên chức năng này bị bỏ hẳn.
- **Phiên quá dài chỉ hiện 3000 message đầu.** Transcript trên máy có file lên tới 220MB; dùng nút "Hiện file transcript" để mở file gốc khi cần.
- Ứng dụng ưu tiên PowerShell 7 (`pwsh.exe`) nếu có, vì xử lý UTF-8 tốt hơn hẳn PowerShell 5.1 — quan trọng khi đường dẫn dự án có dấu tiếng Việt. Đặt biến `CLAUDE_TERMINAL_SHELL` để chỉ định shell khác.

## Cấu trúc mã nguồn

```
src/
  main/                    tiến trình main (Node)
    main.js                vòng đời app, cửa sổ, menu
    ipc-handlers.js        toàn bộ bề mặt IPC
    app-paths.js           mọi đường dẫn file app đụng tới
    theme.js               nguồn sự thật về theme, dùng chung main/renderer
    terminal/
      pty-manager.js       vòng đời tiến trình PTY
      shell-resolver.js    chọn shell và dựng dòng lệnh khởi động
    history/
      transcript-parser.js chuẩn hoá một dòng JSONL
      history-index.js     metadata các phiên + điều phối cache
      content-cache.js     bản hội thoại rút gọn, tự quản lý tính hợp lệ
      history-worker.js    worker: dựng cache và tìm kiếm
      history-worker-client.js  phía main điều phối worker
      history-search.js    chọn phạm vi tìm, gắn kết quả về phiên
      transcript-reader.js đọc một phiên để hiển thị
    storage/               đọc/ghi JSON, scrollback, trạng thái workspace,
                           sao và ghi chú phiên, trạng thái tài khoản
                           (account-status.js chỉ đọc, lọc bỏ token)
    usage/
      usage-limits.js      hạn mức gói real-time (gọi API, chống 429)
      usage-local.js       ngữ cảnh + chi phí hôm nay (đọc file, cache tách đôi)
  preload/preload.js       cầu nối duy nhất giữa renderer và main
  renderer/
    styles/tokens.css      token thiết kế cho cả hai theme
    styles/app.css         mọi thành phần giao diện
    js/
      app.js               khởi tạo và nối các thành phần
      theme-manager.js     áp theme, đồng bộ bảng màu sang xterm
      terminal-tabs.js     tab terminal và vòng đời xterm
      terminal-find.js     tìm trong nội dung terminal
      command-palette.js   bảng lệnh Ctrl+K
      quick-send.js        nút đổi model và hàng nút gõ nhanh
      account-panel.js     trạng thái tài khoản, đăng nhập, hồ sơ
      history-panel.js     danh sách phiên, nhóm thời gian, tìm kiếm
      transcript-view.js   khung xem hội thoại và mục lục
      projects-sidebar.js  sidebar dự án phân tầng
      format-utils.js      định dạng dùng chung
```

Renderer chạy với `contextIsolation`, không có `nodeIntegration`, và CSP chặn mọi tài nguyên từ xa. Nội dung transcript là dữ liệu không tin cậy nên mọi thứ đưa vào DOM đều được escape.
