# Neon Rush 3D — Thiết kế kiến trúc và phạm vi sản phẩm

## 1. Mục tiêu sản phẩm

Neon Rush 3D là game đua xe arcade 3D chạy trên trình duyệt, lấy cảm hứng từ nhịp độ và cảm giác tốc độ của Asphalt Nitro. Sản phẩm ưu tiên cảm giác lái dễ tiếp cận, hình ảnh neon, tốc độ cao, phản hồi điều khiển nhanh và khả năng chơi offline sau khi cài đặt PWA.

Sản phẩm không sao chép tài sản, tên, bản đồ hoặc mã nguồn của Asphalt Nitro. Xe, đường đua, âm thanh, giao diện và nội dung sẽ là tài sản gốc hoặc mã nguồn mở phù hợp.

## 2. Phạm vi bản đầu tiên

### 2.1 Nội dung đua

- Ba đường đua cố định, thiết kế thủ công:
  - Thành phố đêm neon.
  - Cao tốc ven biển.
  - Đèo núi.
- Sáu xe với thông số khác nhau.
- Năm đối thủ AI có độ khó cân bằng.
- Mỗi chặng gồm ba vòng.
- Không có xe dân sự hoặc traffic nền.
- Có chướng ngại vật cố định, số lượng ít và người chơi có thể tránh.
- Va chạm chỉ làm giảm tốc độ và tạo phản hồi hình ảnh/âm thanh; không có hệ thống hư hại xe.

### 2.2 Chế độ chơi

- Quick Race: chọn đường, chọn xe, đua ngay.
- Career theo cup:
  - Mỗi cup có năm sự kiện.
  - Sự kiện gồm Race, Time Attack và Drift/Nitro Challenge.
  - Hoàn thành cup mở khóa nội dung tiếp theo.
- Career sử dụng trình tự cup tuyến tính, có sự kiện phụ và phần thưởng để tăng khả năng chơi lại.

### 2.3 Garage và tiến trình

- Mở khóa xe bằng tiến độ Career và tiền đua.
- Nâng cấp các nhóm:
  - Động cơ/tốc độ.
  - Gia tốc.
  - Độ bám/xử lý.
  - Nitro.
- Cosmetic: màu sơn và mâm xe.
- Nâng cấp tạo khác biệt rõ nhưng không bắt buộc người chơi phải grind.
- Quick Race sử dụng xe và tiến trình đã mở khóa.

### 2.4 Nền tảng và phân phối

- Chạy trên Chrome/Edge/Safari desktop và Chrome/Safari mobile hiện đại.
- Desktop ưu tiên, mobile được tối ưu riêng.
- PWA đầy đủ:
  - Có manifest và service worker.
  - Cache toàn bộ runtime và asset sau lần tải đầu.
  - Có thể chơi offline toàn bộ nội dung đã tải.
  - Có fallback khi ngoại tuyến.
- Lưu tiến trình, cài đặt và garage bằng localStorage/IndexedDB; không yêu cầu tài khoản hoặc backend.

## 3. Kiến trúc tổng thể

### 3.1 Stack

- Three.js cho render 3D và scene graph.
- TypeScript cho toàn bộ logic ứng dụng.
- Vite cho development server và production build.
- WebGL2 là target chính; có fallback rõ ràng khi thiết bị không hỗ trợ.
- Web Audio API cho music và sound effects.
- Service Worker API cho PWA/offline.
- localStorage hoặc IndexedDB cho save game và settings.

### 3.2 Các hệ thống

1. **App Bootstrap**
   - Khởi tạo renderer, scene, camera, audio, storage, input và PWA.
   - Điều phối chuyển trạng thái: Menu, Countdown, Racing, Paused, Results.

2. **Renderer/World**
   - Quản lý scene, ánh sáng, fog, sky, ground, city props, weather và post-processing nhẹ.
   - Tách tài sản tĩnh và động để giảm chi phí render.
   - Hỗ trợ quality presets và adaptive quality.

3. **Track System**
   - Định nghĩa đường đua cố định bằng spline/waypoint.
   - Sinh mesh đường, barrier, lane, checkpoint, start/finish và minimap.
   - Cung cấp hàm truy vấn vị trí, hướng, độ cong, khoảng cách và progress.
   - Không tạo đường procedural trong bản đầu tiên.

4. **Vehicle System**
   - Trạng thái xe: vị trí, hướng, vận tốc, tốc độ, grip, nitro, drift, upgrade stats.
   - Vật lý arcade: throttle, brake, steering, drag, off-road, collision response.
   - Hệ thống hiệu ứng: drift smoke, nitro flame, skid, camera shake.
   - Xe người chơi và AI dùng chung vehicle interface.

5. **AI System**
   - Đi theo racing line từ track data.
   - Điều chỉnh tốc độ theo độ cong, chướng ngại vật và xe phía trước.
   - Có aggression/skill profile để tạo năm mức đối thủ cân bằng.
   - Không dùng pathfinding thời gian thực cho bản đầu tiên.

6. **Race Director**
   - Countdown, race timer, lap validation, checkpoint, vị trí, event objectives.
   - Xử lý start, pause, resume, restart, finish và disqualification nếu cần.
   - Tính kết quả Race, Time Attack, Drift Challenge và Nitro Challenge.

7. **Career/Garage Service**
   - Cấu hình xe, cup, sự kiện, rewards và unlock conditions.
   - Tính tiền, XP, progress, upgrade levels và cosmetic ownership.
   - Lưu/load save atomically; không làm mất dữ liệu khi game đóng giữa chừng.

8. **Input System**
   - Desktop: WASD, mũi tên, Shift, Space, camera controls, pause/restart.
   - Mobile control mode: touch buttons hoặc tilt, chọn trong Settings.
   - abstraction trả về throttle, brake, steer, drift, nitro và UI actions.
   - Hỗ trợ remapping cơ bản nếu không làm phức tạp MVP.

9. **Camera System**
   - Chase camera mặc định.
   - Hood/bumper camera.
   - Cinematic camera khi xuất phát, về đích và một số khoảnh khắc sự kiện.
   - FOV thay đổi theo tốc độ, shake khi va chạm/nitro, chuyển cảnh mượt.

10. **UI/HUD**
    - Menu chính, garage, career map/cup, race setup, settings, pause, results.
    - HUD: tốc độ, vòng, vị trí, thời gian, nitro, drift score, minimap, event objective.
    - Responsive cho desktop và mobile; touch controls chỉ hiển thị khi phù hợp.
    - Settings lưu quality, control mode, camera, audio và các tùy chọn hiển thị.

11. **Audio System**
    - Music nền có nhiều lớp hoặc nhiều track theo trạng thái.
    - SFX: engine, nitro, drift, collision, countdown, UI, finish.
    - Audio mixer riêng cho music, SFX và engine; có mute và volume controls.
    - Asset audio phải có giấy phép phù hợp hoặc được tạo/thu âm riêng.

12. **Quality/Performance System**
    - Presets: Auto, Low, Medium, High, Ultra.
    - Auto benchmark ngắn khi vào game và theo dõi FPS trong race.
    - Điều chỉnh resolution scale, shadow map, particle count, traffic/props density, post-processing và texture budget.
    - Giữ logic đua ổn định khi render quality thay đổi.

13. **PWA/Storage Layer**
    - Manifest, icons, theme color, splash metadata.
    - Service worker cache versioning và update flow.
    - Offline route fallback.
    - Save schema versioning và migration đơn giản.

## 4. Luồng chơi chính

1. Người chơi mở app, PWA tải và cache runtime/asset.
2. Menu chính cho phép Quick Race, Career, Garage, Settings.
3. Chọn chế độ, đường đua/cup và xe.
4. Race Director tạo grid, khóa input và chạy countdown.
5. Người chơi đua ba vòng, vượt checkpoint và hoàn thành objective.
6. Kết quả được tính, thưởng được cấp, save được ghi.
7. Người chơi quay lại Career, Quick Race hoặc Garage.

## 5. Data model chính

### 5.1 VehicleConfig

- id, displayName, description.
- baseSpeed, acceleration, grip, nitroPower, nitroCapacity, mass.
- unlockCondition, upgradeSlots, cosmetic options.

### 5.2 TrackConfig

- id, displayName, environment, length, lapCount.
- spline/waypoints, startTransform, pit/grid slots.
- checkpoints, obstacles, minimap path, weather/night variants.

### 5.3 EventConfig

- id, type: Race | TimeAttack | DriftChallenge | NitroChallenge.
- trackId, requiredLaps, targetTime/score, aiLoadout, reward.
- difficulty modifiers và điều kiện hoàn thành.

### 5.4 SaveData

- schemaVersion.
- careerProgress, completedEvents, currency, xp.
- ownedVehicles, selectedVehicle, upgradeLevels.
- cosmetics, bestTimes, bestScores, settings.

### 5.5 QualitySettings

- preset, resolutionScale, shadows, antiAliasing, textureQuality.
- particleBudget, propDensity, postProcessing, adaptiveEnabled.

## 6. Tiêu chuẩn chất lượng

### 6.1 Hiệu năng

- Desktop hiện đại nhắm 60 FPS ở preset phù hợp.
- Mobile nhắm trải nghiệm mượt; Auto giảm quality động khi FPS giảm.
- Không block main thread bằng tải asset hoặc lưu save lớn.
- Asset được nén và chia bundle hợp lý.

### 6.2 Điều khiển

- Phản hồi throttle/steering trong một frame.
- Touch và tilt có calibration, dead zone và tùy chọn đảo chiều nếu cần.
- Camera không làm mất quyền kiểm soát xe.
- Pause/resume/restart hoạt động ổn định.

### 6.3 Ổn định

- Không crash khi chuyển quality, camera, pause, restart hoặc offline.
- Save/load không làm trắng tiến trình.
- Race có thể hoàn tất khi không có mạng sau lần cài đặt đầu.
- Không có traffic nền theo yêu cầu thiết kế.

## 7. Kiểm thử và tiêu chí hoàn thành

### 7.1 Kiểm thử bắt buộc

- Build production thành công.
- Chạy được trên desktop và mobile browser hiện đại.
- PWA cài đặt được và chơi offline sau khi cache đầy đủ.
- Hoàn thành một cup, mở khóa xe/nâng cấp, thoát và load save đúng.
- Kiểm tra cả ba control modes: keyboard, touch, tilt.
- Kiểm tra cả ba camera.
- Kiểm tra cả năm graphics presets và adaptive downgrade/upgrade.
- Kiểm tra pause, resume, restart, back to menu.
- Kiểm tra Race, Time Attack, Drift Challenge và Nitro Challenge.
- Kiểm tra không có asset vi phạm bản quyền.

### 7.2 Tiêu chí chấp nhận MVP

- Người chơi có thể vào game, chọn xe, đua ba vòng và về đích.
- AI đủ cạnh tranh nhưng không gây khó chịu.
- Nitro, drift, va chạm, minimap và HUD hoạt động rõ ràng.
- Career/cup cho cảm giác mở khóa và tiến bộ.
- Settings graphics có tác động rõ đến hình ảnh và FPS.
- PWA offline hoạt động đáng tin cậy.
- Không có crash, soft-lock hoặc mất save trong các luồng chính.

## 8. Ngoài phạm vi bản đầu tiên

- Online multiplayer, matchmaking, leaderboard và anti-cheat.
- Tài khoản người dùng và đồng bộ đám mây.
- Traffic dân sự.
- Hư hại xe chi tiết.
- Đường đua procedural hoàn toàn.
- Editor đường đua.
- Console hoặc native app.
- Microtransaction.

## 9. Rủi ro và quyết định thiết kế

- WebGL/mobile performance có thể khác nhau mạnh: dùng adaptive quality và benchmark ngắn.
- Asset audio/visual mã nguồn mở cần kiểm tra giấy phép trước khi đóng gói.
- Career procedural không được làm mất cảm giác đường đua thủ công: chỉ xáo trộn sự kiện, thời tiết, mục tiêu và phần thưởng.
- PWA cache lớn cần versioning và cập nhật an toàn.
- Vật lý arcade cần tuning sớm trên thiết bị thật để tránh cảm giác quá nhẹ hoặc quá khó.
