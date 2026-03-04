import PhotosUI
import SwiftUI
import UIKit

struct ScanView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = ScanViewModel()
    @State private var selectedItem: PhotosPickerItem? = nil
    @State private var showCamera: Bool = false
    @State private var showError: Bool = false

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            if viewModel.isAnalyzing {
                analyzingView
            } else {
                pickerView
            }
        }
        .sheet(isPresented: $viewModel.showResult) {
            ScanResultView(viewModel: viewModel)
                .onDisappear {
                    if !viewModel.showResult {
                        dismiss()
                    }
                }
        }
        .alert("Could Not Detect Food", isPresented: $showError) {
            Button("Try Again", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
        .onChange(of: viewModel.errorMessage) { _, newValue in
            showError = newValue != nil
        }
        .onChange(of: selectedItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await viewModel.analyze(image: image)
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPickerView { image in
                showCamera = false
                Task {
                    await viewModel.analyze(image: image)
                }
            }
        }
    }

    private var pickerView: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white.opacity(0.5))
                        .symbolRenderingMode(.hierarchical)
                }
                Spacer()
                Text("Scan Food")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Color.clear.frame(width: 28, height: 28)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 32)

            VStack(spacing: 20) {
                ZStack {
                    RoundedRectangle(cornerRadius: 32)
                        .fill(Color.cardBackground)
                        .overlay(
                            RoundedRectangle(cornerRadius: 32)
                                .stroke(
                                    LinearGradient(
                                        colors: [Color.neonGreen.opacity(0.6), Color.neonGreen.opacity(0.1)],
                                        startPoint: .topLeading, endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 1.5
                                )
                        )

                    VStack(spacing: 24) {
                        ZStack {
                            Circle()
                                .fill(Color.neonGreen.opacity(0.1))
                                .frame(width: 100, height: 100)
                            Circle()
                                .fill(Color.neonGreen.opacity(0.08))
                                .frame(width: 130, height: 130)
                            Image(systemName: "camera.fill")
                                .font(.system(size: 40, weight: .medium))
                                .foregroundStyle(Color.neonGreen)
                        }

                        VStack(spacing: 8) {
                            Text("Snap your meal")
                                .font(.title2.weight(.bold))
                                .foregroundStyle(.white)
                            Text("Take a photo or choose from your library.\nAI will identify foods and estimate macros.")
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.5))
                                .multilineTextAlignment(.center)
                        }

                        VStack(spacing: 12) {
#if targetEnvironment(simulator)
                            PhotosPicker(selection: $selectedItem, matching: .images) {
                                ActionButton(icon: "photo.fill", title: "Choose from Library", isPrimary: true)
                            }
#else
                            Button {
                                showCamera = true
                            } label: {
                                ActionButton(icon: "camera.fill", title: "Take Photo", isPrimary: true)
                            }
                            PhotosPicker(selection: $selectedItem, matching: .images) {
                                ActionButton(icon: "photo.fill", title: "Choose from Library", isPrimary: false)
                            }
#endif
                        }
                    }
                    .padding(32)
                }
                .padding(.horizontal, 20)

                Text("Gemini 1.5 Flash • Instant nutrition estimates")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.25))
            }
            Spacer()
        }
    }

    private var analyzingView: some View {
        VStack(spacing: 32) {
            Spacer()

            ZStack {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .stroke(Color.neonGreen.opacity(0.3 - Double(i) * 0.08), lineWidth: 1.5)
                        .frame(width: CGFloat(100 + i * 40), height: CGFloat(100 + i * 40))
                }
                Image(systemName: "sparkles")
                    .font(.system(size: 44, weight: .medium))
                    .foregroundStyle(Color.neonGreen)
                    .symbolEffect(.pulse)
            }

            VStack(spacing: 10) {
                Text("Analyzing your meal...")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
                Text("Gemini is identifying foods and calculating nutrition")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.45))
                    .multilineTextAlignment(.center)
            }

            if let image = viewModel.selectedImage {
                Color.cardBackground
                    .frame(width: 120, height: 120)
                    .overlay {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .allowsHitTesting(false)
                    }
                    .clipShape(.rect(cornerRadius: 20))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(Color.neonGreen.opacity(0.3), lineWidth: 1.5)
                    )
            }

            Spacer()
        }
        .padding(.horizontal, 32)
    }
}

struct ActionButton: View {
    let icon: String
    let title: String
    let isPrimary: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold))
            Text(title)
                .font(.callout.weight(.semibold))
        }
        .foregroundStyle(isPrimary ? .black : .white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(isPrimary ? Color.neonGreen : Color.white.opacity(0.08))
        .clipShape(.rect(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(isPrimary ? Color.clear : Color.white.opacity(0.1), lineWidth: 1)
        )
    }
}

struct CameraPickerView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        init(onCapture: @escaping (UIImage) -> Void) { self.onCapture = onCapture }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = info[.originalImage] as? UIImage {
                onCapture(img)
            }
            picker.dismiss(animated: true)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}
